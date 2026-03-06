class RedisRoomMirror {
  constructor({
    redisUri = '',
    keyPrefix = 'daieryou:room-mirror',
    snapshotTtlMs = 24 * 60 * 60 * 1000,
    connectTimeoutMs = 3000,
    logger = console,
    createRedisClient = null,
  } = {}) {
    this.redisUri = typeof redisUri === 'string' ? redisUri.trim() : ''
    this.keyPrefix = keyPrefix
    this.snapshotTtlMs = snapshotTtlMs
    this.connectTimeoutMs = connectTimeoutMs
    this.logger = logger
    this.createRedisClient = createRedisClient
    this.client = null
    this.connecting = null
  }

  get enabled() {
    return Boolean(this.redisUri)
  }

  get idsKey() {
    return `${this.keyPrefix}:ids`
  }

  roomKey(roomId) {
    return `${this.keyPrefix}:room:${roomId}`
  }

  isReady() {
    return Boolean(this.client && this.client.isReady)
  }

  loadRedisFactory() {
    if (typeof this.createRedisClient === 'function') {
      return this.createRedisClient
    }

    try {
      const redisModule = require('redis')
      if (typeof redisModule.createClient === 'function') {
        return redisModule.createClient
      }

      return null
    } catch (error) {
      this.logger.warn('[room-mirror] Redis module missing, mirror disabled')
      return null
    }
  }

  async ensureConnected() {
    if (!this.enabled) {
      return false
    }

    if (this.isReady()) {
      return true
    }

    if (this.connecting) {
      return this.connecting
    }

    const createClient = this.loadRedisFactory()
    if (!createClient) {
      return false
    }

    const connectPromise = (async () => {
      const client = createClient({
        url: this.redisUri,
        socket: {
          connectTimeout: this.connectTimeoutMs,
        },
      })
      client.on('error', (error) => {
        this.logger.error('[room-mirror] Redis error:', error.message)
      })

      try {
        await client.connect()
      } catch (error) {
        this.logger.error('[room-mirror] Redis connect failed:', error.message)
        try {
          await client.disconnect()
        } catch (disconnectError) {
          // no-op
        }
        return false
      }

      this.client = client
      return true
    })()

    this.connecting = connectPromise
    const connected = await connectPromise
    this.connecting = null
    return connected
  }

  parseRoomPayload(roomId, raw) {
    try {
      const room = JSON.parse(raw)
      if (!room || typeof room !== 'object' || room.id !== roomId || !Array.isArray(room.players)) {
        throw new Error('invalid room payload')
      }

      return room
    } catch (error) {
      return null
    }
  }

  async cleanupInvalidRoom(roomId) {
    if (!this.client) {
      return
    }

    await this.client.del(this.roomKey(roomId))
    await this.client.sRem(this.idsKey, roomId)
  }

  async loadRoom(roomId) {
    const connected = await this.ensureConnected()
    if (!connected) {
      return null
    }

    const raw = await this.client.get(this.roomKey(roomId))
    if (!raw) {
      await this.client.sRem(this.idsKey, roomId)
      return null
    }

    const room = this.parseRoomPayload(roomId, raw)
    if (!room) {
      this.logger.warn(`[room-mirror] Invalid room payload for ${roomId}, dropped`)
      await this.cleanupInvalidRoom(roomId)
      return null
    }

    return room
  }

  async listRooms() {
    const connected = await this.ensureConnected()
    if (!connected) {
      return []
    }

    const roomIds = await this.client.sMembers(this.idsKey)
    const rooms = []
    for (const roomId of roomIds) {
      const room = await this.loadRoom(roomId)
      if (room) {
        rooms.push(room)
      }
    }

    return rooms
  }

  async restoreToRepository(roomRepository) {
    const connected = await this.ensureConnected()
    if (!connected) {
      return { enabled: false, restored: 0 }
    }

    const roomIds = await this.client.sMembers(this.idsKey)
    let restored = 0
    for (const roomId of roomIds) {
      const room = await this.loadRoom(roomId)
      if (!room) {
        continue
      }

      roomRepository.save(room, { skipMirror: true })
      restored += 1
    }

    return { enabled: true, restored }
  }

  async saveRoom(room) {
    const connected = await this.ensureConnected()
    if (!connected) {
      return false
    }

    const payload = JSON.stringify(room)
    const roomKey = this.roomKey(room.id)
    const multi = this.client.multi()
    multi.sAdd(this.idsKey, room.id)

    if (this.snapshotTtlMs > 0) {
      multi.set(roomKey, payload, {
        PX: this.snapshotTtlMs,
      })
    } else {
      multi.set(roomKey, payload)
    }

    await multi.exec()
    return true
  }

  async deleteRoom(roomId) {
    if (!this.isReady()) {
      return false
    }

    await this.client.multi()
      .del(this.roomKey(roomId))
      .sRem(this.idsKey, roomId)
      .exec()
    return true
  }

  async shutdown() {
    if (!this.client) {
      return
    }

    try {
      await this.client.quit()
    } catch (error) {
      try {
        await this.client.disconnect()
      } catch (disconnectError) {
        // no-op
      }
    }

    this.client = null
  }
}

module.exports = { RedisRoomMirror }

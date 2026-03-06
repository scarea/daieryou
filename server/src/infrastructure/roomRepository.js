class RoomRepository {
  constructor({ roomMirror = null, maxInMemoryRooms = Number.POSITIVE_INFINITY } = {}) {
    this.rooms = new Map()
    this.roomMirror = roomMirror
    this.maxInMemoryRooms = Number.isFinite(maxInMemoryRooms) && maxInMemoryRooms > 0
      ? maxInMemoryRooms
      : Number.POSITIVE_INFINITY
    this.pendingMirrorOps = new Map()
  }

  save(room, options = {}) {
    const now = Date.now()
    if (!room.createdAt) {
      room.createdAt = now
    }
    room.updatedAt = now
    this.rooms.set(room.id, room)

    if (!options.skipMirror && this.roomMirror?.saveRoom) {
      this.pushMirrorSave(room)
    }

    this.evictIfNeeded(room.id)

    return room
  }

  get(roomId) {
    return this.rooms.get(roomId) || null
  }

  delete(roomId, options = {}) {
    this.deleteLocal(roomId)

    if (!options.skipMirror && this.roomMirror?.deleteRoom) {
      this.pushMirrorDelete(roomId)
    }
  }

  listWaitingRooms() {
    return Array.from(this.rooms.values()).filter((room) => room.status === 'waiting')
  }

  findByUserId(userId) {
    return Array.from(this.rooms.values()).find((room) => room.players.some((player) => player.id === userId)) || null
  }

  entries() {
    return this.rooms.entries()
  }

  listAll() {
    return Array.from(this.rooms.values())
  }

  deleteLocal(roomId) {
    this.rooms.delete(roomId)
  }

  getEvictionPriority(room) {
    if (room.status === 'finished') {
      return 0
    }

    const allOffline = Array.isArray(room.players)
      && room.players.length > 0
      && room.players.every((player) => player.online === false)

    if (room.status === 'waiting' && allOffline) {
      return 1
    }

    if (room.status === 'waiting') {
      return 2
    }

    if (room.status === 'playing') {
      return 4
    }

    return 3
  }

  evictIfNeeded(protectedRoomId = null) {
    if (!Number.isFinite(this.maxInMemoryRooms)) {
      return
    }

    const overflow = this.rooms.size - this.maxInMemoryRooms
    if (overflow <= 0) {
      return
    }

    const candidates = Array.from(this.rooms.values())
      .filter((room) => room.id !== protectedRoomId)
      .sort((left, right) => {
        const leftPriority = this.getEvictionPriority(left)
        const rightPriority = this.getEvictionPriority(right)
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority
        }

        const leftUpdatedAt = left.updatedAt || left.createdAt || 0
        const rightUpdatedAt = right.updatedAt || right.createdAt || 0
        if (leftUpdatedAt !== rightUpdatedAt) {
          return leftUpdatedAt - rightUpdatedAt
        }

        return left.id.localeCompare(right.id)
      })

    for (let index = 0; index < overflow && index < candidates.length; index += 1) {
      this.deleteLocal(candidates[index].id)
    }
  }

  pushMirrorSave(room) {
    this.roomMirror.saveRoom(room)
      .then((saved) => {
        if (saved === false) {
          throw new Error('mirror save returned false')
        }
      })
      .catch((error) => {
        console.error('[room-repository] mirror save failed:', error.message)
        this.pendingMirrorOps.set(room.id, {
          type: 'save',
          room,
        })
      })
  }

  pushMirrorDelete(roomId) {
    this.roomMirror.deleteRoom(roomId)
      .then((deleted) => {
        if (deleted === false) {
          throw new Error('mirror delete returned false')
        }
      })
      .catch((error) => {
        console.error('[room-repository] mirror delete failed:', error.message)
        this.pendingMirrorOps.set(roomId, {
          type: 'delete',
          roomId,
        })
      })
  }

  getPendingMirrorOpsCount() {
    return this.pendingMirrorOps.size
  }

  async retryPendingMirrorOps({ maxOps = 100 } = {}) {
    if (!this.roomMirror || this.pendingMirrorOps.size === 0) {
      return { retried: 0, failed: 0, remaining: this.pendingMirrorOps.size }
    }

    let retried = 0
    let failed = 0
    const entries = Array.from(this.pendingMirrorOps.entries()).slice(0, maxOps)

    for (const [key, operation] of entries) {
      try {
        if (operation.type === 'save') {
          const saved = await this.roomMirror.saveRoom(operation.room)
          if (saved === false) {
            throw new Error('mirror save returned false')
          }
        } else if (operation.type === 'delete') {
          const deleted = await this.roomMirror.deleteRoom(operation.roomId)
          if (deleted === false) {
            throw new Error('mirror delete returned false')
          }
        } else {
          this.pendingMirrorOps.delete(key)
          continue
        }

        retried += 1
        this.pendingMirrorOps.delete(key)
      } catch (error) {
        failed += 1
      }
    }

    return {
      retried,
      failed,
      remaining: this.pendingMirrorOps.size,
    }
  }

  async loadRoomFromMirror(roomId) {
    if (!this.roomMirror?.loadRoom) {
      return null
    }

    const room = await this.roomMirror.loadRoom(roomId)
    if (!room) {
      return null
    }

    this.save(room, { skipMirror: true })
    return room
  }

  async syncFromMirror({ onlyMissing = true } = {}) {
    if (!this.roomMirror?.listRooms) {
      return { enabled: false, restored: 0 }
    }

    const rooms = await this.roomMirror.listRooms()
    let restored = 0
    for (const room of rooms) {
      if (onlyMissing && this.rooms.has(room.id)) {
        continue
      }

      this.save(room, { skipMirror: true })
      restored += 1
    }

    return { enabled: true, restored }
  }
}

module.exports = { RoomRepository }

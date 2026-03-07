const { v4: uuidv4 } = require('uuid')
const gameConfig = require('../../config/game-config.json')
const { serializePlayer, serializeRoom, serializeRoomList } = require('../domain/roomView')

const DEFAULT_BOT_SCORE = 1000
const DEFAULT_MAX_BOTS_PER_ROOM = 2
const DEFAULT_SELECTION_TIMEOUT_MS = 60000
const MIN_SELECTION_TIMEOUT_MS = 10000
const MAX_SELECTION_TIMEOUT_MS = 180000
const BOT_DIFFICULTIES = new Set(['easy', 'normal', 'hard'])

class RoomService {
  constructor({
    roomRepository,
    broadcaster,
    lobbyBroadcaster,
    botConfig = {},
    defaultRoundSelectionTimeoutMs = DEFAULT_SELECTION_TIMEOUT_MS,
  }) {
    this.roomRepository = roomRepository
    this.broadcaster = broadcaster
    this.lobbyBroadcaster = lobbyBroadcaster
    this.botConfig = {
      enabled: botConfig.enabled === true,
      maxPerRoom: Number.isInteger(botConfig.maxPerRoom) && botConfig.maxPerRoom >= 0
        ? botConfig.maxPerRoom
        : DEFAULT_MAX_BOTS_PER_ROOM,
      defaultDifficulty: typeof botConfig.defaultDifficulty === 'string' && botConfig.defaultDifficulty.trim()
        ? botConfig.defaultDifficulty.trim().toLowerCase()
        : 'normal',
    }
    this.defaultRoundSelectionTimeoutMs = Number.isInteger(defaultRoundSelectionTimeoutMs)
      && defaultRoundSelectionTimeoutMs >= MIN_SELECTION_TIMEOUT_MS
      && defaultRoundSelectionTimeoutMs <= MAX_SELECTION_TIMEOUT_MS
      ? defaultRoundSelectionTimeoutMs
      : DEFAULT_SELECTION_TIMEOUT_MS
  }

  getCurrentRoomForUser(userId) {
    return this.roomRepository.findByUserId(userId)
  }

  getRoomList() {
    return serializeRoomList(this.roomRepository.listWaitingRooms())
  }

  isBotPlayer(player) {
    return player?.isBot === true
  }

  normalizeBotCount(value, fallback = 1) {
    const normalized = Math.floor(Number(value))
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return fallback
    }

    return normalized
  }

  normalizeBotDifficulty(value) {
    if (typeof value !== 'string') {
      return this.botConfig.defaultDifficulty
    }

    const normalized = value.trim().toLowerCase()
    if (!BOT_DIFFICULTIES.has(normalized)) {
      return this.botConfig.defaultDifficulty
    }

    return normalized
  }

  normalizeSelectionTimeoutMs(value) {
    const normalized = Math.floor(Number(value))
    if (!Number.isFinite(normalized)) {
      return this.defaultRoundSelectionTimeoutMs
    }
    if (normalized < MIN_SELECTION_TIMEOUT_MS) {
      return MIN_SELECTION_TIMEOUT_MS
    }
    if (normalized > MAX_SELECTION_TIMEOUT_MS) {
      return MAX_SELECTION_TIMEOUT_MS
    }
    return normalized
  }

  buildBotPlayer(room, difficulty) {
    const botIndex = room.players.filter((player) => this.isBotPlayer(player)).length + 1
    return {
      id: `bot-${uuidv4()}`,
      username: `AI-${botIndex}`,
      score: DEFAULT_BOT_SCORE,
      online: true,
      isBot: true,
      botDifficulty: this.normalizeBotDifficulty(difficulty),
      decisionProvider: 'rule',
      lastSeenAt: Date.now(),
    }
  }

  async saveAndBroadcastRoom(room) {
    await this.roomRepository.saveWithMode(room)
    const publicRoom = serializeRoom(room)
    this.broadcaster.broadcast(room, 'roomUpdated', { room: publicRoom })
    this.lobbyBroadcaster.broadcastRoomList()
    return publicRoom
  }

  updateRoomPlayer(room, userId, updater) {
    room.players = room.players.map((player) => {
      if (player.id !== userId) {
        return player
      }

      return updater(player)
    })

    if (room.gameState?.players) {
      room.gameState.players = room.gameState.players.map((player) => {
        if (player.id !== userId) {
          return player
        }

        return updater(player)
      })
    }
  }

  async setUserOnline(user) {
    const room = this.getCurrentRoomForUser(user.id)
    if (!room) {
      return null
    }

    this.updateRoomPlayer(room, user.id, (player) => ({
      ...player,
      username: user.username,
      online: true,
      lastSeenAt: Date.now(),
    }))

    await this.saveAndBroadcastRoom(room)
    this.broadcaster.broadcast(room, 'playerConnectionChanged', {
      room: serializeRoom(room),
      userId: user.id,
      online: true,
      message: `${user.username} 已重新连接`,
    })

    return room
  }

  async setUserOffline(userId, graceMs) {
    const room = this.getCurrentRoomForUser(userId)
    if (!room) {
      return null
    }

    const player = room.players.find((item) => item.id === userId)
    if (!player) {
      return null
    }

    this.updateRoomPlayer(room, userId, (currentPlayer) => ({
      ...currentPlayer,
      online: false,
      lastSeenAt: Date.now(),
    }))

    await this.saveAndBroadcastRoom(room)
    this.broadcaster.broadcast(room, 'playerConnectionChanged', {
      room: serializeRoom(room),
      userId,
      online: false,
      message: `${player.username} 断开连接，系统保留席位 ${Math.floor(graceMs / 1000)} 秒`,
    })

    return room
  }

  async createRoom(user, options = {}) {
    if (!user) {
      throw new Error('用户未登录')
    }

    const existingRoom = this.getCurrentRoomForUser(user.id)
    if (existingRoom) {
      return serializeRoom(existingRoom)
    }

    const room = {
      id: uuidv4(),
      players: [
        {
          ...user,
          online: true,
          lastSeenAt: Date.now(),
        },
      ],
      hostId: user.id,
      status: 'waiting',
      createdAt: Date.now(),
      selectionTimeoutMs: this.normalizeSelectionTimeoutMs(options.selectionTimeoutMs),
      gameState: null,
      finalScores: null,
      finalRoundResult: null,
      finishedAt: null,
    }

    await this.roomRepository.saveWithMode(room)
    this.lobbyBroadcaster.broadcastRoomList()
    return serializeRoom(room)
  }

  async joinRoom(user, roomId) {
    if (!user) {
      throw new Error('用户未登录')
    }

    const room = this.roomRepository.get(roomId)
    if (!room) {
      throw new Error('房间不存在')
    }
    if (room.players.length >= 3) {
      throw new Error('房间已满')
    }
    if (room.status !== 'waiting') {
      throw new Error('游戏已开始')
    }
    if (room.players.some((player) => player.id === user.id)) {
      throw new Error('已在房间中')
    }

    room.players.push({
      ...user,
      online: true,
      lastSeenAt: Date.now(),
    })

    this.broadcaster.broadcast(room, 'playerJoined', {
      player: serializePlayer(user),
      room: serializeRoom(room),
    })
    return this.saveAndBroadcastRoom(room)
  }

  async addBots(user, roomId, options = {}) {
    if (!user) {
      throw new Error('用户未登录')
    }
    if (!this.botConfig.enabled) {
      throw new Error('AI 人机功能未开启')
    }

    const room = this.roomRepository.get(roomId)
    if (!room) {
      throw new Error('房间不存在')
    }
    if (room.hostId !== user.id) {
      throw new Error('只有房主可以添加 AI')
    }
    if (room.status !== 'waiting') {
      throw new Error('只有等待中的房间可以添加 AI')
    }

    const requestedCount = this.normalizeBotCount(options.count, 1)
    const roomCapacity = gameConfig.maxPlayersPerRoom || 3
    const availableSlots = Math.max(0, roomCapacity - room.players.length)
    if (availableSlots <= 0) {
      throw new Error('房间已满')
    }

    const currentBotCount = room.players.filter((player) => this.isBotPlayer(player)).length
    const remainBotQuota = Math.max(0, this.botConfig.maxPerRoom - currentBotCount)
    if (remainBotQuota <= 0) {
      throw new Error('已达到房间 AI 上限')
    }

    const toAdd = Math.min(requestedCount, availableSlots, remainBotQuota)
    const addedBots = []
    for (let index = 0; index < toAdd; index += 1) {
      const botPlayer = this.buildBotPlayer(room, options.difficulty)
      room.players.push(botPlayer)
      addedBots.push(botPlayer)
    }

    if (addedBots.length === 0) {
      throw new Error('没有可添加的 AI 席位')
    }

    addedBots.forEach((botPlayer) => {
      this.broadcaster.broadcast(room, 'playerJoined', {
        player: serializePlayer(botPlayer),
        room: serializeRoom(room),
      })
    })

    const publicRoom = await this.saveAndBroadcastRoom(room)
    return {
      room: publicRoom,
      addedBots: addedBots.map(serializePlayer),
    }
  }

  async removeBot(user, roomId, botPlayerId) {
    if (!user) {
      throw new Error('用户未登录')
    }
    if (!this.botConfig.enabled) {
      throw new Error('AI 人机功能未开启')
    }

    const room = this.roomRepository.get(roomId)
    if (!room) {
      throw new Error('房间不存在')
    }
    if (room.hostId !== user.id) {
      throw new Error('只有房主可以移除 AI')
    }
    if (room.status !== 'waiting') {
      throw new Error('只有等待中的房间可以移除 AI')
    }

    const botPlayer = room.players.find((player) => player.id === botPlayerId && this.isBotPlayer(player))
    if (!botPlayer) {
      throw new Error('AI 玩家不存在')
    }

    room.players = room.players.filter((player) => player.id !== botPlayerId)
    const publicRoom = await this.saveAndBroadcastRoom(room)
    this.broadcaster.broadcast(room, 'playerLeft', {
      userId: botPlayer.id,
      player: serializePlayer(botPlayer),
      room: publicRoom,
    })

    return {
      room: publicRoom,
      removedBot: serializePlayer(botPlayer),
    }
  }

  async leaveRoom(user, roomId) {
    if (!user) {
      throw new Error('用户未登录')
    }

    const room = this.roomRepository.get(roomId)
    if (!room) {
      throw new Error('房间不存在')
    }
    if (!room.players.some((player) => player.id === user.id)) {
      throw new Error('不在房间中')
    }

    return this.removeUserFromRoom(room, user.id, {
      reason: `${user.username} 已离开房间`,
      playerPayload: serializePlayer(user),
    })
  }

  async removeUserFromRoom(room, userId, options = {}) {
    const leavingPlayer = room.players.find((player) => player.id === userId)
    if (!leavingPlayer) {
      return { deleted: false, room: serializeRoom(room) }
    }

    const wasPlaying = room.status === 'playing'
    room.players = room.players.filter((player) => player.id !== userId)

    if (room.gameState?.players) {
      room.gameState.players = room.gameState.players.filter((player) => player.id !== userId)
    }

    if (room.players.length === 0) {
      await this.roomRepository.deleteWithMode(room.id)
      this.lobbyBroadcaster.broadcastRoomList()
      return { deleted: true, room: null }
    }

    if (room.hostId === userId) {
      room.hostId = room.players[0].id
    }

    if (wasPlaying) {
      room.status = 'finished'
      room.gameState = null
      room.finalScores = null
      room.finalRoundResult = null
      room.finishedAt = Date.now()
    }

    await this.roomRepository.saveWithMode(room)

    const publicRoom = serializeRoom(room)
    this.broadcaster.broadcast(room, 'playerLeft', {
      userId,
      player: options.playerPayload || serializePlayer(leavingPlayer),
      room: publicRoom,
    })
    this.broadcaster.broadcast(room, 'roomUpdated', { room: publicRoom })

    if (wasPlaying) {
      this.broadcaster.broadcast(room, 'gameAborted', {
        room: publicRoom,
        reason: options.reason || `${leavingPlayer.username} 已离开房间，本局结束`,
      })
    }

    this.lobbyBroadcaster.broadcastRoomList()
    return { deleted: false, room: publicRoom }
  }

  async cleanupUserFromRooms(userId, options = {}) {
    for (const [, room] of this.roomRepository.entries()) {
      if (!room.players.some((player) => player.id === userId)) {
        continue
      }

      await this.removeUserFromRoom(room, userId, options)
    }
  }
}

module.exports = { RoomService }

const gameConfig = require('../../config/game-config.json')
const { createInitialGameState, calculateRound, prepareNextRound, getPublicGameState } = require('../domain/gameEngine')
const { serializeRoom } = require('../domain/roomView')

class GameService {
  constructor({
    roomRepository,
    broadcaster,
    lobbyBroadcaster,
    roundSelectionTimeoutMs = 30000,
  }) {
    this.roomRepository = roomRepository
    this.broadcaster = broadcaster
    this.lobbyBroadcaster = lobbyBroadcaster
    this.roundSelectionTimeoutMs = Number.isInteger(roundSelectionTimeoutMs) && roundSelectionTimeoutMs > 0
      ? roundSelectionTimeoutMs
      : 30000
    this.roundTimers = new Map()
  }

  getGameSnapshot(room, userId) {
    if (!room?.gameState) {
      return null
    }

    return getPublicGameState(room.gameState, userId)
  }

  ensureReadyPlayers(room) {
    if (room.players.length !== gameConfig.maxPlayersPerRoom) {
      throw new Error('需要3名玩家才能开始游戏')
    }

    if (room.players.some((player) => player.online === false)) {
      throw new Error('有玩家离线，无法开始游戏')
    }
  }

  clearRoundTimer(roomId) {
    const timer = this.roundTimers.get(roomId)
    if (!timer) {
      return
    }

    clearTimeout(timer)
    this.roundTimers.delete(roomId)
  }

  scheduleRoundTimer(room) {
    if (!room?.gameState || room.status !== 'playing') {
      return
    }

    this.clearRoundTimer(room.id)
    const timeoutMs = Number.isInteger(room.gameState.selectionTimeoutMs) && room.gameState.selectionTimeoutMs > 0
      ? room.gameState.selectionTimeoutMs
      : this.roundSelectionTimeoutMs

    room.gameState.roundDeadlineAt = Date.now() + timeoutMs
    const timer = setTimeout(() => {
      this.roundTimers.delete(room.id)
      this.handleRoundTimeout(room.id)
    }, timeoutMs)

    if (typeof timer.unref === 'function') {
      timer.unref()
    }

    this.roundTimers.set(room.id, timer)
  }

  broadcastGameStateUpdate(room, reason = 'state') {
    const publicRoom = serializeRoom(room)
    this.broadcaster.broadcastPerPlayer(room, 'gameStateUpdated', (targetPlayer) => ({
      room: publicRoom,
      gameState: getPublicGameState(room.gameState, targetPlayer.id),
      reason,
    }))
  }

  getAutoSelectedCards(player) {
    if (!Array.isArray(player?.handCards) || player.handCards.length < 2) {
      return []
    }

    return [0, 1]
  }

  autoSelectMissingPlayers(gameState) {
    let autoSelectedCount = 0
    gameState.players.forEach((player) => {
      if (player.hasSelected) {
        return
      }

      const autoSelectedCards = this.getAutoSelectedCards(player)
      if (autoSelectedCards.length !== 2) {
        return
      }

      player.selectedCards = autoSelectedCards
      player.hasSelected = true
      player.selectedByTimeout = true
      autoSelectedCount += 1
    })

    return autoSelectedCount
  }

  resolveRoundIfReady(room, responseUserId = null) {
    if (!room?.gameState || !room.gameState.players.every((item) => item.hasSelected)) {
      return null
    }

    this.clearRoundTimer(room.id)
    const roundResult = calculateRound(room.gameState)
    const publicRoom = serializeRoom(room)

    if (room.gameState.currentRound < room.gameState.maxRounds) {
      prepareNextRound(room.gameState, roundResult.loserIndex)
      this.scheduleRoundTimer(room)
      this.roomRepository.save(room)
      this.broadcaster.broadcastPerPlayer(room, 'roundResult', (targetPlayer) => ({
        roundResult,
        room: publicRoom,
        gameState: getPublicGameState(room.gameState, targetPlayer.id),
      }))

      if (responseUserId) {
        return getPublicGameState(room.gameState, responseUserId)
      }

      return null
    }

    const finalGameStateSnapshots = new Map(
      room.players.map((playerItem) => [
        playerItem.id,
        getPublicGameState(room.gameState, playerItem.id),
      ]),
    )

    room.status = 'finished'
    room.finishedAt = Date.now()
    room.finalScores = room.gameState.players.map((playerItem) => ({
      playerId: playerItem.id,
      username: playerItem.username,
      totalScore: playerItem.totalScore,
      roundScores: playerItem.roundScores,
    }))
    room.gameState = null

    this.roomRepository.save(room)
    const finishedRoom = serializeRoom(room)
    this.broadcaster.broadcast(room, 'roomUpdated', { room: finishedRoom })
    this.broadcaster.broadcastPerPlayer(room, 'roundResult', (targetPlayer) => ({
      roundResult,
      room: finishedRoom,
      gameState: finalGameStateSnapshots.get(targetPlayer.id) || null,
    }))
    this.broadcaster.broadcastPerPlayer(room, 'gameEnded', (targetPlayer) => ({
      finalScores: room.finalScores,
      room: finishedRoom,
      gameState: finalGameStateSnapshots.get(targetPlayer.id) || null,
    }))
    this.lobbyBroadcaster.broadcastRoomList()

    if (responseUserId) {
      return finalGameStateSnapshots.get(responseUserId) || null
    }

    return null
  }

  handleRoundTimeout(roomId) {
    const room = this.roomRepository.get(roomId)
    if (!room?.gameState || room.status !== 'playing') {
      return
    }

    const autoSelectedCount = this.autoSelectMissingPlayers(room.gameState)
    if (autoSelectedCount === 0) {
      return
    }

    this.roomRepository.save(room)
    if (!room.gameState.players.every((item) => item.hasSelected)) {
      this.broadcastGameStateUpdate(room, 'timeout-partial')
      this.scheduleRoundTimer(room)
      this.roomRepository.save(room)
      return
    }

    this.resolveRoundIfReady(room, null)
  }

  startGame(user, roomId) {
    if (!user) {
      throw new Error('用户未登录')
    }

    const room = this.roomRepository.get(roomId)
    if (!room) {
      throw new Error('房间不存在')
    }
    if (room.status !== 'waiting') {
      throw new Error('游戏已经开始')
    }
    if (room.hostId !== user.id) {
      throw new Error('只有房主可以开始游戏')
    }

    this.ensureReadyPlayers(room)

    this.clearRoundTimer(room.id)
    room.gameState = createInitialGameState(room.players, {
      selectionTimeoutMs: this.roundSelectionTimeoutMs,
    })
    room.finalScores = null
    room.finishedAt = null
    room.status = 'playing'
    this.scheduleRoundTimer(room)
    this.roomRepository.save(room)

    const publicRoom = serializeRoom(room)
    this.broadcaster.broadcast(room, 'roomUpdated', { room: publicRoom })
    this.broadcaster.broadcastPerPlayer(room, 'gameStarted', (player) => ({
      room: publicRoom,
      gameState: getPublicGameState(room.gameState, player.id),
    }))
    this.lobbyBroadcaster.broadcastRoomList()

    return getPublicGameState(room.gameState, user.id)
  }

  restartGame(user, roomId) {
    if (!user) {
      throw new Error('用户未登录')
    }

    const room = this.roomRepository.get(roomId)
    if (!room) {
      throw new Error('房间不存在')
    }
    if (room.hostId !== user.id) {
      throw new Error('只有房主可以再来一局')
    }
    if (room.status !== 'finished') {
      throw new Error('当前对局尚未结束')
    }

    this.ensureReadyPlayers(room)

    this.clearRoundTimer(room.id)
    room.gameState = createInitialGameState(room.players, {
      selectionTimeoutMs: this.roundSelectionTimeoutMs,
    })
    room.finalScores = null
    room.finishedAt = null
    room.status = 'playing'
    this.scheduleRoundTimer(room)
    this.roomRepository.save(room)

    const publicRoom = serializeRoom(room)
    this.broadcaster.broadcast(room, 'roomUpdated', { room: publicRoom })
    this.broadcaster.broadcastPerPlayer(room, 'gameStarted', (player) => ({
      room: publicRoom,
      gameState: getPublicGameState(room.gameState, player.id),
    }))
    this.lobbyBroadcaster.broadcastRoomList()

    return getPublicGameState(room.gameState, user.id)
  }

  selectCards(user, roomId, round, selectedCards) {
    if (!user) {
      throw new Error('用户未登录')
    }

    const room = this.roomRepository.get(roomId)
    if (!room || !room.gameState) {
      throw new Error('游戏不存在')
    }
    if (room.status !== 'playing') {
      throw new Error('当前对局未进行中')
    }
    if (!Array.isArray(selectedCards) || selectedCards.length !== 2) {
      throw new Error('必须选择2张牌')
    }

    const playerIndex = room.gameState.players.findIndex((player) => player.id === user.id)
    if (playerIndex === -1) {
      throw new Error('不在游戏中')
    }

    const player = room.gameState.players[playerIndex]
    const deduplicated = Array.from(new Set(selectedCards)).sort((left, right) => left - right)

    if (round !== room.gameState.currentRound) {
      if (round < room.gameState.currentRound) {
        return getPublicGameState(room.gameState, user.id)
      }
      throw new Error('当前回合已更新，请重新选择')
    }
    if (deduplicated.length !== 2) {
      throw new Error('必须选择2张不同的牌')
    }

    const isValid = deduplicated.every((cardIndex) => Number.isInteger(cardIndex) && cardIndex >= 0 && cardIndex < player.handCards.length)
    if (!isValid) {
      throw new Error('选择的牌无效')
    }

    if (player.hasSelected) {
      const previousSelection = Array.isArray(player.selectedCards)
        ? [...player.selectedCards].sort((left, right) => left - right)
        : []
      const isSameSelection = previousSelection.length === deduplicated.length
        && previousSelection.every((value, index) => value === deduplicated[index])
      if (isSameSelection) {
        return getPublicGameState(room.gameState, user.id)
      }

      throw new Error('本轮已选牌，请等待其他玩家')
    }

    player.selectedCards = deduplicated
    player.hasSelected = true
    player.selectedByTimeout = false
    this.roomRepository.save(room)

    const responseGameState = this.resolveRoundIfReady(room, user.id)
    if (responseGameState !== null) {
      return responseGameState
    }

    this.broadcastGameStateUpdate(room, 'selection-progress')
    return room.gameState ? getPublicGameState(room.gameState, user.id) : null
  }
}

module.exports = { GameService }

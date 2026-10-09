const gameConfig = require('../../config/game-config.json')
const {
  createInitialGameState,
  calculateRound,
  prepareNextRound,
  getPublicGameState,
  isSelectionRequiredRound,
} = require('../domain/gameEngine')
const { serializeRoom } = require('../domain/roomView')

const DEFAULT_BOT_DECISION_TIMEOUT_MS = 120

class GameService {
  constructor({
    roomRepository,
    broadcaster,
    lobbyBroadcaster,
    battleRecordService = null,
    botDecisionService = null,
    botDecisionTimeoutMs = DEFAULT_BOT_DECISION_TIMEOUT_MS,
    roundSelectionTimeoutMs = 30000,
  }) {
    this.roomRepository = roomRepository
    this.broadcaster = broadcaster
    this.lobbyBroadcaster = lobbyBroadcaster
    this.battleRecordService = battleRecordService
    this.botDecisionService = botDecisionService
    this.botDecisionTimeoutMs = Number.isInteger(botDecisionTimeoutMs) && botDecisionTimeoutMs > 0
      ? botDecisionTimeoutMs
      : DEFAULT_BOT_DECISION_TIMEOUT_MS
    this.roundSelectionTimeoutMs = Number.isInteger(roundSelectionTimeoutMs) && roundSelectionTimeoutMs > 0
      ? roundSelectionTimeoutMs
      : 30000
    this.roundTimers = new Map()
    this.roomLocks = new Map()
  }

  // 同一房间的对局操作（开局/选牌/超时结算）串行执行。
  // 这些流程中间有 await，交错执行会导致同一回合被重复结算、gameState 被提前清空。
  runExclusive(roomId, task) {
    const key = String(roomId)
    const previous = this.roomLocks.get(key) || Promise.resolve()
    const run = previous.then(() => task())
    const tail = run.catch(() => {})
    this.roomLocks.set(key, tail)
    tail.then(() => {
      if (this.roomLocks.get(key) === tail) {
        this.roomLocks.delete(key)
      }
    })
    return run
  }

  // await 之后房间可能已被其他流程改动（例如玩家离开导致对局中止）
  isGameActive(room) {
    return Boolean(room?.gameState) && room.status === 'playing'
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

  isSelectionRound(gameState) {
    if (!gameState) {
      return false
    }

    return isSelectionRequiredRound(gameState.currentRound, gameState.maxRounds)
  }

  scheduleRoundTimer(room) {
    if (!room?.gameState || room.status !== 'playing' || !this.isSelectionRound(room.gameState)) {
      return
    }

    this.clearRoundTimer(room.id)
    const timeoutMs = Number.isInteger(room.gameState.selectionTimeoutMs) && room.gameState.selectionTimeoutMs > 0
      ? room.gameState.selectionTimeoutMs
      : this.roundSelectionTimeoutMs

    room.gameState.roundDeadlineAt = Date.now() + timeoutMs
    const timer = setTimeout(() => {
      this.roundTimers.delete(room.id)
      this.handleRoundTimeout(room.id).catch(() => {})
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

  isBotPlayer(player) {
    return player?.isBot === true
  }

  setGameAction(gameState, type, payload = {}) {
    if (!gameState) {
      return
    }

    const nextSeq = Number(gameState.actionSeq || 0) + 1
    gameState.actionSeq = nextSeq
    gameState.phase = payload.phase || gameState.phase || 'selecting'
    gameState.lastAction = {
      ...payload,
      type,
      round: Number(payload.round || gameState.currentRound || 1),
      seq: nextSeq,
      at: Date.now(),
    }
  }

  logBotDecision({
    roomId,
    round,
    playerId,
    provider,
    latencyMs,
    fallback,
    reason,
    selectedCards,
    source,
  }) {
    console.log('[bot-action]', JSON.stringify({
      ts: new Date().toISOString(),
      roomId,
      round,
      playerId,
      provider,
      latencyMs,
      fallback,
      reason,
      selectedCards,
      source,
    }))
  }

  buildKnownRemovedCards(room) {
    if (!room?.gameState?.roundResults || !Array.isArray(room.gameState.roundResults)) {
      return []
    }

    const knownRemovedCards = []
    room.gameState.roundResults.forEach((roundResult) => {
      if (!Array.isArray(roundResult?.playerResults)) {
        return
      }

      roundResult.playerResults.forEach((playerResult) => {
        if (!Array.isArray(playerResult?.hand)) {
          return
        }
        playerResult.hand.forEach((card) => {
          if (card && typeof card === 'object' && Number.isFinite(card.rank)) {
            knownRemovedCards.push(card)
          }
        })
      })
    })

    return knownRemovedCards
  }

  buildBotDecisionInput(room, player) {
    const currentRound = Number(room?.gameState?.currentRound || 1)
    const maxRounds = Number(room?.gameState?.maxRounds || gameConfig.gameRounds)
    const publicCards = Array.isArray(room?.gameState?.publicCards)
      ? room.gameState.publicCards
      : []
    const publicCardIndex = Math.min(
      Math.max(currentRound - 1, 0),
      Math.max(0, publicCards.length - 1),
    )
    const hiddenPublicCardRound = maxRounds - 1
    const hiddenPublicCardIndex = hiddenPublicCardRound - 1
    const isPublicCardHidden = currentRound === hiddenPublicCardRound
    const visiblePublicCards = publicCards.filter((_, index) => index !== hiddenPublicCardIndex)
    const remainingPublicCards = publicCards.filter((_, index) => (
      index > publicCardIndex && index !== hiddenPublicCardIndex
    ))
    const selectionRound = this.isSelectionRound(room?.gameState)

    return {
      roomId: room.id,
      round: currentRound,
      maxRounds,
      opponentCount: Math.max(0, (room?.gameState?.players?.length || 1) - 1),
      selectionRound,
      isPublicCardHidden,
      publicCard: selectionRound && !isPublicCardHidden ? (publicCards[publicCardIndex] || null) : null,
      knownPublicCards: visiblePublicCards,
      knownRemovedCards: this.buildKnownRemovedCards(room),
      remainingPublicCards,
      player: {
        id: player?.id,
        username: player?.username,
        handCards: Array.isArray(player?.handCards) ? player.handCards : [],
        botDifficulty: player?.botDifficulty || 'normal',
        totalScore: Number(player?.totalScore || 0),
      },
      playerStates: Array.isArray(room?.gameState?.players)
        ? room.gameState.players.map((item) => ({
          id: item?.id,
          username: item?.username,
          totalScore: Number(item?.totalScore || 0),
          isBot: item?.isBot === true,
          botDifficulty: item?.botDifficulty || 'normal',
        }))
        : [],
    }
  }

  async decideCardsForBot(room, player, source = 'bot-decision') {
    const fallbackSelection = this.getAutoSelectedCards(player)
    if (fallbackSelection.length !== 2) {
      return []
    }

    if (!this.botDecisionService?.decideSelection) {
      return fallbackSelection
    }

    try {
      const decisionInput = this.buildBotDecisionInput(room, player)
      const decision = await this.botDecisionService.decideSelection(decisionInput, {
        timeoutMs: this.botDecisionTimeoutMs,
      })

      const selectedCards = Array.isArray(decision?.selectedCards) && decision.selectedCards.length === 2
        ? [...decision.selectedCards].sort((left, right) => left - right)
        : fallbackSelection
      this.logBotDecision({
        roomId: room.id,
        round: room.gameState?.currentRound || 1,
        playerId: player.id,
        provider: decision?.provider || 'fallback',
        latencyMs: decision?.latencyMs || 0,
        fallback: decision?.fallback === true,
        reason: decision?.reason || null,
        selectedCards,
        source,
      })
      return selectedCards
    } catch (error) {
      this.logBotDecision({
        roomId: room.id,
        round: room.gameState?.currentRound || 1,
        playerId: player.id,
        provider: 'fallback',
        latencyMs: 0,
        fallback: true,
        reason: error?.message || 'bot_decision_failed',
        selectedCards: fallbackSelection,
        source,
      })
      return fallbackSelection
    }
  }

  async applyBotDecisions(room, source = 'bot-decision') {
    if (!room?.gameState || room.status !== 'playing' || !this.isSelectionRound(room.gameState)) {
      return 0
    }

    let decidedCount = 0
    for (const player of room.gameState.players) {
      if (!this.isBotPlayer(player) || player.hasSelected) {
        continue
      }

      const selectedCards = await this.decideCardsForBot(room, player, source)
      if (!Array.isArray(selectedCards) || selectedCards.length !== 2) {
        continue
      }

      player.selectedCards = selectedCards
      player.hasSelected = true
      player.selectedByTimeout = false
      decidedCount += 1
    }

    return decidedCount
  }

  autoSelectMissingPlayers(gameState) {
    if (!this.isSelectionRound(gameState)) {
      return 0
    }

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

  async resolveRoundIfReady(room, responseUserId = null) {
    if (!this.isGameActive(room) || !room.gameState.players.every((item) => item.hasSelected)) {
      return null
    }

    this.clearRoundTimer(room.id)
    const roundResult = calculateRound(room.gameState)
    const publicRoom = serializeRoom(room)

    if (room.gameState.currentRound < room.gameState.maxRounds) {
      const resolvedRound = room.gameState.currentRound
      prepareNextRound(room.gameState, roundResult.loserIndexes || roundResult.loserIndex)
      this.setGameAction(room.gameState, 'roundAdvanced', {
        phase: 'selecting',
        round: resolvedRound,
        nextRound: room.gameState.currentRound,
        loserIndexes: roundResult.loserIndexes || [],
      })
      await this.applyBotDecisions(room, 'round-advanced')
      if (!this.isGameActive(room)) {
        return null
      }
      this.scheduleRoundTimer(room)
      await this.roomRepository.saveWithMode(room)
      if (!this.isGameActive(room)) {
        return null
      }
      this.broadcaster.broadcastPerPlayer(room, 'roundResult', (targetPlayer) => ({
        roundResult,
        room: publicRoom,
        gameState: getPublicGameState(room.gameState, targetPlayer.id),
      }))

      if (room.gameState && room.gameState.players.every((item) => item.hasSelected)) {
        return this.resolveRoundIfReady(room, responseUserId)
      }

      if (responseUserId) {
        return getPublicGameState(room.gameState, responseUserId)
      }

      return null
    }

    this.setGameAction(room.gameState, 'gameEnded', {
      phase: 'finished',
      round: room.gameState.currentRound,
      loserIndexes: roundResult.loserIndexes || [],
    })

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
    room.finalRoundResult = roundResult
    // 保留整局各轮结果，断线重连后结算面板仍能展示本局高光
    room.finalRoundResults = Array.isArray(room.gameState.roundResults) ? [...room.gameState.roundResults] : []
    // AI 默认已准备，界面上直接显示为 2/3、1/3 等
    room.restartReadyIds = room.players.filter((player) => player.isBot === true).map((player) => player.id)
    room.gameState = null
    if (this.battleRecordService?.recordGameFinished) {
      try {
        await this.battleRecordService.recordGameFinished({
          roomId: room.id,
          finishedAt: room.finishedAt,
          finalScores: room.finalScores,
        })
      } catch (error) {
        // no-op
      }
    }

    await this.roomRepository.saveWithMode(room)
    const finishedRoom = serializeRoom(room)
    this.broadcaster.broadcast(room, 'roomUpdated', { room: finishedRoom })
    this.broadcaster.broadcastPerPlayer(room, 'roundResult', (targetPlayer) => ({
      roundResult,
      room: finishedRoom,
      gameState: finalGameStateSnapshots.get(targetPlayer.id) || null,
    }))
    this.broadcaster.broadcastPerPlayer(room, 'gameEnded', (targetPlayer) => ({
      finalScores: room.finalScores,
      finalRoundResult: room.finalRoundResult,
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
    return this.runExclusive(roomId, () => this.handleRoundTimeoutLocked(roomId))
  }

  async handleRoundTimeoutLocked(roomId) {
    const room = this.roomRepository.get(roomId)
    if (!room?.gameState || room.status !== 'playing') {
      return
    }

    if (!this.isSelectionRound(room.gameState)) {
      await this.resolveRoundIfReady(room, null)
      return
    }

    await this.applyBotDecisions(room, 'round-timeout')
    if (!this.isGameActive(room)) {
      return
    }
    const autoSelectedCount = this.autoSelectMissingPlayers(room.gameState)
    if (autoSelectedCount === 0) {
      return
    }

    const pendingCount = room.gameState.players.filter((item) => !item.hasSelected).length
    this.setGameAction(room.gameState, 'timeoutAutoSelected', {
      phase: pendingCount === 0 ? 'revealing' : 'selecting',
      autoSelectedCount,
      pendingCount,
    })

    await this.roomRepository.saveWithMode(room)
    if (!room.gameState.players.every((item) => item.hasSelected)) {
      this.broadcastGameStateUpdate(room, 'timeout-partial')
      this.scheduleRoundTimer(room)
      await this.roomRepository.saveWithMode(room)
      return
    }

    await this.resolveRoundIfReady(room, null)
  }

  startGame(user, roomId) {
    return this.runExclusive(roomId, () => this.startGameLocked(user, roomId))
  }

  async startGameLocked(user, roomId) {
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
    return this.beginNewGame(room, user.id, 'game-start')
  }

  restartGame(user, roomId) {
    return this.runExclusive(roomId, () => this.restartGameLocked(user, roomId))
  }

  // 再来一局：每位真人玩家点“准备”，AI 视为已准备；全员准备后自动开新局
  async restartGameLocked(user, roomId) {
    if (!user) {
      throw new Error('用户未登录')
    }

    const room = this.roomRepository.get(roomId)
    if (!room) {
      throw new Error('房间不存在')
    }
    if (!room.players.some((player) => player.id === user.id)) {
      throw new Error('不在该房间中')
    }
    if (room.status !== 'finished') {
      throw new Error('当前对局尚未结束')
    }

    const readyIds = new Set(Array.isArray(room.restartReadyIds) ? room.restartReadyIds : [])
    readyIds.add(user.id)
    room.restartReadyIds = room.players
      .filter((player) => readyIds.has(player.id) || player.isBot === true)
      .map((player) => player.id)

    const everyoneReady = room.players.length === gameConfig.maxPlayersPerRoom
      && room.players.every((player) => room.restartReadyIds.includes(player.id))
    if (!everyoneReady) {
      await this.roomRepository.saveWithMode(room)
      this.broadcaster.broadcast(room, 'roomUpdated', { room: serializeRoom(room) })
      return null
    }

    this.ensureReadyPlayers(room)
    return this.beginNewGame(room, user.id, 'game-restart')
  }

  async beginNewGame(room, responseUserId, source) {
    this.clearRoundTimer(room.id)
    room.gameState = createInitialGameState(room.players, {
      selectionTimeoutMs: Number.isInteger(room.selectionTimeoutMs) && room.selectionTimeoutMs > 0
        ? room.selectionTimeoutMs
        : this.roundSelectionTimeoutMs,
    })
    this.setGameAction(room.gameState, 'deal', { phase: 'selecting', playerCount: room.players.length })
    room.finalScores = null
    room.finalRoundResult = null
    room.finalRoundResults = null
    room.finishedAt = null
    room.restartReadyIds = []
    room.status = 'playing'
    await this.applyBotDecisions(room, source)
    this.scheduleRoundTimer(room)
    await this.roomRepository.saveWithMode(room)

    const publicRoom = serializeRoom(room)
    this.broadcaster.broadcast(room, 'roomUpdated', { room: publicRoom })
    this.broadcaster.broadcastPerPlayer(room, 'gameStarted', (player) => ({
      room: publicRoom,
      gameState: getPublicGameState(room.gameState, player.id),
    }))
    this.lobbyBroadcaster.broadcastRoomList()

    return getPublicGameState(room.gameState, responseUserId)
  }

  selectCards(user, roomId, round, selectedCards) {
    return this.runExclusive(roomId, () => this.selectCardsLocked(user, roomId, round, selectedCards))
  }

  async selectCardsLocked(user, roomId, round, selectedCards) {
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

    const playerIndex = room.gameState.players.findIndex((player) => player.id === user.id)
    if (playerIndex === -1) {
      throw new Error('不在游戏中')
    }

    if (!this.isSelectionRound(room.gameState)) {
      room.gameState.players.forEach((player) => {
        player.hasSelected = true
        player.selectedCards = []
        player.selectedByTimeout = false
      })
      await this.roomRepository.saveWithMode(room)
      const resolvedGameState = await this.resolveRoundIfReady(room, user.id)
      if (resolvedGameState !== null) {
        return resolvedGameState
      }
      return getPublicGameState(room.gameState, user.id)
    }
    if (!Array.isArray(selectedCards) || selectedCards.length !== 2) {
      throw new Error('必须选择2张牌')
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
    await this.applyBotDecisions(room, 'player-selection')
    if (!this.isGameActive(room)) {
      throw new Error('当前对局未进行中')
    }
    const pendingCount = room.gameState.players.filter((item) => !item.hasSelected).length
    this.setGameAction(room.gameState, 'playerSelected', {
      phase: pendingCount === 0 ? 'revealing' : 'selecting',
      playerId: player.id,
      pendingCount,
      selectedCount: deduplicated.length,
    })
    await this.roomRepository.saveWithMode(room)

    const responseGameState = await this.resolveRoundIfReady(room, user.id)
    if (responseGameState !== null) {
      return responseGameState
    }

    this.broadcastGameStateUpdate(room, 'selection-progress')
    return room.gameState ? getPublicGameState(room.gameState, user.id) : null
  }
}

module.exports = { GameService }

const test = require('node:test')
const assert = require('node:assert/strict')
const { GameService } = require('../src/application/gameService')
const { RoomRepository } = require('../src/infrastructure/roomRepository')
const { createInitialGameState } = require('../src/domain/gameEngine')

function createServiceFixture(options = {}) {
  const roomRepository = new RoomRepository()
  const broadcastCalls = []
  const perPlayerBroadcastCalls = []
  const battleRecordCalls = []
  const broadcaster = {
    broadcast(room, event, payload) {
      broadcastCalls.push({ roomId: room.id, event, payload })
    },
    broadcastPerPlayer(room, event, payloadFactory) {
      room.players.forEach((player) => {
        perPlayerBroadcastCalls.push({
          roomId: room.id,
          event,
          userId: player.id,
          payload: payloadFactory(player),
        })
      })
    },
  }

  const lobbyBroadcaster = {
    broadcastRoomListCalls: 0,
    broadcastRoomList() {
      this.broadcastRoomListCalls += 1
    },
  }

  const service = new GameService({
    roomRepository,
    broadcaster,
    lobbyBroadcaster,
    battleRecordService: {
      recordGameFinished(payload) {
        battleRecordCalls.push(payload)
      },
    },
    botDecisionService: options.botDecisionService,
    botDecisionTimeoutMs: options.botDecisionTimeoutMs,
    roundSelectionTimeoutMs: options.roundSelectionTimeoutMs,
  })
  return {
    service,
    roomRepository,
    broadcastCalls,
    perPlayerBroadcastCalls,
    lobbyBroadcaster,
    battleRecordCalls,
  }
}

function createPlayers() {
  return [
    { id: 'u1', username: 'Host', score: 1000, online: true },
    { id: 'u2', username: 'B', score: 1000, online: true },
    { id: 'u3', username: 'C', score: 1000, online: true },
  ]
}

test('startGame should reject non-host user', async () => {
  const { service, roomRepository } = createServiceFixture()
  const players = createPlayers()

  roomRepository.save({
    id: 'room-1',
    hostId: players[0].id,
    status: 'waiting',
    players,
    gameState: null,
    finalScores: null,
    createdAt: Date.now(),
  })

  await assert.rejects(
    () => service.startGame(players[1], 'room-1'),
    /只有房主可以开始游戏/,
  )
})

test('startGame should use room-level selection timeout when configured', async () => {
  const { service, roomRepository } = createServiceFixture({
    roundSelectionTimeoutMs: 30000,
  })
  const players = createPlayers()

  roomRepository.save({
    id: 'room-timeout-config',
    hostId: players[0].id,
    status: 'waiting',
    players,
    selectionTimeoutMs: 60000,
    gameState: null,
    finalScores: null,
    createdAt: Date.now(),
  })

  const gameState = await service.startGame(players[0], 'room-timeout-config')
  assert.equal(gameState.selectionTimeoutMs, 60000)
  assert.ok(Number.isFinite(gameState.roundDeadlineAt))
  assert.equal(gameState.phase, 'selecting')
  assert.equal(gameState.lastAction.type, 'deal')
  assert.equal(gameState.lastAction.playerCount, 3)
  assert.equal(gameState.actionSeq, 1)
})

test('restartGame should reject unfinished room', async () => {
  const { service, roomRepository } = createServiceFixture()
  const players = createPlayers()

  roomRepository.save({
    id: 'room-2',
    hostId: players[0].id,
    status: 'waiting',
    players,
    gameState: null,
    finalScores: null,
    createdAt: Date.now(),
  })

  await assert.rejects(
    () => service.restartGame(players[0], 'room-2'),
    /当前对局尚未结束/,
  )
})

test('selectCards should reject stale round payload', async () => {
  const { service, roomRepository } = createServiceFixture()
  const players = createPlayers()
  const gameState = createInitialGameState(players)
  gameState.currentRound = 1

  roomRepository.save({
    id: 'room-3',
    hostId: players[0].id,
    status: 'playing',
    players,
    gameState,
    finalScores: null,
    createdAt: Date.now(),
  })

  await assert.rejects(
    () => service.selectCards(players[0], 'room-3', 99, [0, 1]),
    /当前回合已更新，请重新选择/,
  )
})

test('selectCards should be idempotent for same player selection in same round', async () => {
  const { service, roomRepository } = createServiceFixture()
  const players = createPlayers()
  const gameState = createInitialGameState(players)
  gameState.currentRound = 1
  gameState.players[0].hasSelected = true
  gameState.players[0].selectedCards = [1, 0]

  roomRepository.save({
    id: 'room-3b',
    hostId: players[0].id,
    status: 'playing',
    players,
    gameState,
    finalScores: null,
    createdAt: Date.now(),
  })

  const snapshot = await service.selectCards(players[0], 'room-3b', 1, [0, 1])
  assert.ok(snapshot)
  assert.equal(snapshot.currentRound, 1)
})

test('selectCards should return latest snapshot for stale past round payload', async () => {
  const { service, roomRepository } = createServiceFixture()
  const players = createPlayers()
  const gameState = createInitialGameState(players)
  gameState.currentRound = 2

  roomRepository.save({
    id: 'room-3c',
    hostId: players[0].id,
    status: 'playing',
    players,
    gameState,
    finalScores: null,
    createdAt: Date.now(),
  })

  const snapshot = await service.selectCards(players[0], 'room-3c', 1, [0, 1])
  assert.ok(snapshot)
  assert.equal(snapshot.currentRound, 2)
})

test('selectCards should release room.gameState after final round', async () => {
  const { service, roomRepository, perPlayerBroadcastCalls, battleRecordCalls } = createServiceFixture()
  const players = createPlayers()
  const gameState = createInitialGameState(players)
  gameState.currentRound = gameState.maxRounds
  gameState.players[1].selectedCards = [0, 1]
  gameState.players[1].hasSelected = true
  gameState.players[2].selectedCards = [0, 1]
  gameState.players[2].hasSelected = true

  roomRepository.save({
    id: 'room-4',
    hostId: players[0].id,
    status: 'playing',
    players,
    gameState,
    finalScores: null,
    createdAt: Date.now(),
  })

  const snapshot = await service.selectCards(players[0], 'room-4', gameState.maxRounds, [0, 1])
  const room = roomRepository.get('room-4')
  const gameEndedEvents = perPlayerBroadcastCalls.filter((entry) => entry.event === 'gameEnded')

  assert.ok(snapshot)
  assert.equal(snapshot.currentRound, gameState.maxRounds)
  assert.equal(room.status, 'finished')
  assert.equal(room.gameState, null)
  assert.equal(room.finalScores.length, 3)
  assert.ok(room.finalRoundResult)
  assert.equal(room.finalRoundResult.round, gameState.maxRounds)
  assert.equal(room.finalRoundResult.playerResults.length, 3)
  assert.equal(gameEndedEvents.length, 3)
  assert.ok(gameEndedEvents.every((entry) => entry.payload.gameState))
  assert.ok(gameEndedEvents.every((entry) => entry.payload.finalRoundResult))
  assert.ok(gameEndedEvents.every((entry) => entry.payload.finalRoundResult.playerResults.length === 3))
  assert.equal(battleRecordCalls.length, 1)
  assert.equal(battleRecordCalls[0].roomId, 'room-4')
  assert.equal(Array.isArray(battleRecordCalls[0].finalScores), true)
  assert.equal(battleRecordCalls[0].finalScores.length, 3)
})

test('selectCards should broadcast gameStateUpdated while waiting other players', async () => {
  const { service, roomRepository, perPlayerBroadcastCalls } = createServiceFixture()
  const players = createPlayers()
  const gameState = createInitialGameState(players)

  roomRepository.save({
    id: 'room-5',
    hostId: players[0].id,
    status: 'playing',
    players,
    gameState,
    finalScores: null,
    createdAt: Date.now(),
  })

  await service.selectCards(players[0], 'room-5', 1, [0, 1])
  const gameStateUpdatedEvents = perPlayerBroadcastCalls.filter((entry) => entry.event === 'gameStateUpdated')

  assert.equal(gameStateUpdatedEvents.length, 3)
  assert.ok(gameStateUpdatedEvents.every((entry) => entry.payload.reason === 'selection-progress'))
  assert.ok(gameStateUpdatedEvents.every((entry) => entry.payload.gameState.lastAction.type === 'playerSelected'))
  assert.ok(gameStateUpdatedEvents.every((entry) => entry.payload.gameState.lastAction.playerId === players[0].id))
  assert.ok(gameStateUpdatedEvents.every((entry) => entry.payload.gameState.phase === 'selecting'))
})

test('round timeout should auto select pending players and resolve round', async () => {
  const { service, roomRepository, perPlayerBroadcastCalls } = createServiceFixture({
    roundSelectionTimeoutMs: 80,
  })
  const players = createPlayers()

  roomRepository.save({
    id: 'room-timeout',
    hostId: players[0].id,
    status: 'waiting',
    players,
    gameState: null,
    finalScores: null,
    createdAt: Date.now(),
  })

  await service.startGame(players[0], 'room-timeout')
  await new Promise((resolve) => setTimeout(resolve, 120))

  const roundResultEvents = perPlayerBroadcastCalls.filter((entry) => entry.event === 'roundResult')
  assert.ok(roundResultEvents.length >= 3)
  assert.ok(roundResultEvents.some((entry) => (
    entry.payload.roundResult.playerResults.some((playerResult) => playerResult.selectedByTimeout === true)
  )))
})

test('selectCards should apply bot decisions before timeout fallback', async () => {
  const botDecisionCalls = []
  const { service, roomRepository, perPlayerBroadcastCalls } = createServiceFixture({
    botDecisionService: {
      async decideSelection({ player }) {
        botDecisionCalls.push(player.id)
        return {
          selectedCards: [0, 1],
          provider: 'rule',
          latencyMs: 1,
          fallback: false,
        }
      },
    },
    botDecisionTimeoutMs: 50,
  })

  const players = [
    { id: 'u1', username: 'Host', score: 1000, online: true },
    { id: 'bot-1', username: 'AI-1', score: 1000, online: true, isBot: true },
    { id: 'bot-2', username: 'AI-2', score: 1000, online: true, isBot: true },
  ]

  roomRepository.save({
    id: 'room-bot-play',
    hostId: players[0].id,
    status: 'waiting',
    players,
    gameState: null,
    finalScores: null,
    createdAt: Date.now(),
  })

  await service.startGame(players[0], 'room-bot-play')
  const inGameRoom = roomRepository.get('room-bot-play')
  assert.equal(
    inGameRoom.gameState.players.filter((player) => player.isBot).every((player) => player.hasSelected === true),
    true,
  )

  await service.selectCards(players[0], 'room-bot-play', 1, [0, 1])
  const roundResultEvents = perPlayerBroadcastCalls.filter((entry) => entry.event === 'roundResult')
  assert.ok(roundResultEvents.length >= 3)
  assert.ok(botDecisionCalls.length >= 2)

  const botSelections = roundResultEvents[0].payload.roundResult.playerResults
    .filter((playerResult) => String(playerResult.playerName || '').startsWith('AI-'))
  assert.equal(botSelections.length, 2)
  assert.equal(botSelections.every((playerResult) => playerResult.selectedByTimeout === false), true)
})

test('decideCardsForBot should hide round-4 public card from decision input', async () => {
  let capturedInput = null
  const { service } = createServiceFixture({
    botDecisionService: {
      async decideSelection(input) {
        capturedInput = input
        return {
          selectedCards: [0, 1],
          provider: 'rule',
          latencyMs: 1,
          fallback: false,
        }
      },
    },
  })

  const botPlayer = {
    id: 'bot-1',
    username: 'AI-1',
    score: 1000,
    online: true,
    isBot: true,
    botDifficulty: 'hard',
    handCards: [
      { suit: 'spades', rank: 1 },
      { suit: 'hearts', rank: 10 },
      { suit: 'diamonds', rank: 9 },
      { suit: 'clubs', rank: 6 },
      { suit: 'spades', rank: 5 },
    ],
    totalScore: 0,
  }
  const room = {
    id: 'room-hidden-public',
    status: 'playing',
    gameState: {
      currentRound: 4,
      maxRounds: 5,
      publicCards: [
        { suit: 'spades', rank: 3 },
        { suit: 'hearts', rank: 8 },
        { suit: 'diamonds', rank: 11 },
        { suit: 'clubs', rank: 13 },
      ],
      roundResults: [
        {
          round: 1,
          playerResults: [
            {
              hand: [
                { suit: 'hearts', rank: 4 },
                { suit: 'clubs', rank: 7 },
                { suit: 'spades', rank: 3 },
              ],
            },
            {
              hand: [
                { suit: 'diamonds', rank: 5 },
                { suit: 'hearts', rank: 6 },
                { suit: 'spades', rank: 3 },
              ],
            },
          ],
        },
      ],
      players: [
        { id: 'host', username: 'Host', totalScore: 1 },
        botPlayer,
        { id: 'guest', username: 'Guest', totalScore: -1 },
      ],
    },
  }

  const selected = await service.decideCardsForBot(room, botPlayer, 'test')

  assert.deepEqual(selected, [0, 1])
  assert.ok(capturedInput)
  assert.equal(capturedInput.round, 4)
  assert.equal(capturedInput.isPublicCardHidden, true)
  assert.equal(capturedInput.publicCard, null)
  assert.equal(capturedInput.knownPublicCards.length, 3)
  assert.equal(Array.isArray(capturedInput.knownRemovedCards), true)
  assert.equal(capturedInput.knownRemovedCards.length > 0, true)
})

const test = require('node:test')
const assert = require('node:assert/strict')
const { RoomRepository } = require('../src/infrastructure/roomRepository')
const { RoomService } = require('../src/application/roomService')

function createRoomServiceFixture() {
  const roomRepository = new RoomRepository()
  const broadcaster = {
    broadcast() {},
  }
  const lobbyBroadcaster = {
    broadcastRoomList() {},
  }

  const roomService = new RoomService({ roomRepository, broadcaster, lobbyBroadcaster })
  return { roomService, roomRepository }
}

function createBotRoomServiceFixture() {
  const roomRepository = new RoomRepository()
  const broadcastEvents = []
  const broadcaster = {
    broadcast(room, event, payload) {
      broadcastEvents.push({ roomId: room?.id, event, payload })
    },
  }
  const lobbyBroadcaster = {
    broadcastRoomList() {},
  }

  const roomService = new RoomService({
    roomRepository,
    broadcaster,
    lobbyBroadcaster,
    botConfig: {
      enabled: true,
      maxPerRoom: 2,
      defaultDifficulty: 'normal',
    },
  })

  return { roomService, roomRepository, broadcastEvents }
}

test('leaveRoom should reject user that is not in target room', async () => {
  const { roomService, roomRepository } = createRoomServiceFixture()
  const host = { id: 'u1', username: 'Host', score: 1000, online: true }
  const outsider = { id: 'u9', username: 'Outsider', score: 1000, online: true }

  roomRepository.save({
    id: 'room-1',
    hostId: host.id,
    status: 'waiting',
    players: [host],
    gameState: null,
    finalScores: null,
    createdAt: Date.now(),
  })

  await assert.rejects(
    () => roomService.leaveRoom(outsider, 'room-1'),
    /不在房间中/,
  )
})

test('createRoom should apply default selection timeout', async () => {
  const { roomService } = createRoomServiceFixture()
  const host = { id: 'u1', username: 'Host', score: 1000, online: true }

  const room = await roomService.createRoom(host)
  assert.ok(room)
  assert.equal(room.selectionTimeoutMs, 60000)
})

test('createRoom should clamp selection timeout from create options', async () => {
  const { roomService } = createRoomServiceFixture()
  const hostA = { id: 'u10', username: 'HostA', score: 1000, online: true }
  const hostB = { id: 'u11', username: 'HostB', score: 1000, online: true }

  const fastRoom = await roomService.createRoom(hostA, { selectionTimeoutMs: 1000 })
  const slowRoom = await roomService.createRoom(hostB, { selectionTimeoutMs: 999999 })

  assert.equal(fastRoom.selectionTimeoutMs, 10000)
  assert.equal(slowRoom.selectionTimeoutMs, 180000)
})

test('addBots should allow host to add bot players in waiting room', async () => {
  const { roomService, roomRepository } = createBotRoomServiceFixture()
  const host = { id: 'u1', username: 'Host', score: 1000, online: true }

  roomRepository.save({
    id: 'room-bot-1',
    hostId: host.id,
    status: 'waiting',
    players: [host],
    gameState: null,
    finalScores: null,
    createdAt: Date.now(),
  })

  const result = await roomService.addBots(host, 'room-bot-1', { count: 2, difficulty: 'hard' })
  assert.ok(result.room)
  assert.equal(result.room.players.length, 3)
  assert.equal(result.addedBots.length, 2)
  assert.equal(result.addedBots.every((player) => player.isBot === true), true)
  assert.equal(result.addedBots.every((player) => player.botDifficulty === 'hard'), true)
})

test('addBots should reject when bot feature is disabled', async () => {
  const { roomService, roomRepository } = createRoomServiceFixture()
  const host = { id: 'u1', username: 'Host', score: 1000, online: true }

  roomRepository.save({
    id: 'room-bot-disabled',
    hostId: host.id,
    status: 'waiting',
    players: [host],
    gameState: null,
    finalScores: null,
    createdAt: Date.now(),
  })

  await assert.rejects(
    () => roomService.addBots(host, 'room-bot-disabled', { count: 1 }),
    /AI 人机功能未开启/,
  )
})

test('removeBot should remove the target bot player', async () => {
  const { roomService, roomRepository } = createBotRoomServiceFixture()
  const host = { id: 'u1', username: 'Host', score: 1000, online: true }

  roomRepository.save({
    id: 'room-bot-2',
    hostId: host.id,
    status: 'waiting',
    players: [host],
    gameState: null,
    finalScores: null,
    createdAt: Date.now(),
  })

  const added = await roomService.addBots(host, 'room-bot-2', { count: 1 })
  const botPlayerId = added.addedBots[0].id
  const removed = await roomService.removeBot(host, 'room-bot-2', botPlayerId)

  assert.ok(removed.room)
  assert.equal(removed.removedBot.id, botPlayerId)
  assert.equal(removed.room.players.length, 1)
})

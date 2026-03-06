const test = require('node:test')
const assert = require('node:assert/strict')
const { RoomRepository } = require('../src/infrastructure/roomRepository')
const { RoomLifecycleService } = require('../src/application/roomLifecycleService')

function createLifecycleFixture() {
  const roomRepository = new RoomRepository()
  const lobbyBroadcaster = {
    count: 0,
    broadcastRoomList() {
      this.count += 1
    },
  }

  const lifecycleService = new RoomLifecycleService({
    roomRepository,
    lobbyBroadcaster,
    sweepIntervalMs: 1000,
    finishedRoomTtlMs: 1000,
    offlineWaitingRoomTtlMs: 1000,
  })

  return { roomRepository, lifecycleService, lobbyBroadcaster }
}

test('cleanupExpiredRooms should remove expired finished rooms', () => {
  const { roomRepository, lifecycleService, lobbyBroadcaster } = createLifecycleFixture()
  const now = Date.now()

  roomRepository.save({
    id: 'room-finished',
    status: 'finished',
    players: [{ id: 'u1', username: 'A', online: true }],
    createdAt: now - 10_000,
    finishedAt: now - 10_000,
  })

  const removed = lifecycleService.cleanupExpiredRooms(now)
  assert.deepEqual(removed, ['room-finished'])
  assert.equal(roomRepository.get('room-finished'), null)
  assert.equal(lobbyBroadcaster.count, 1)
})

test('cleanupExpiredRooms should remove offline waiting rooms', () => {
  const { roomRepository, lifecycleService, lobbyBroadcaster } = createLifecycleFixture()
  const now = Date.now()

  roomRepository.save({
    id: 'room-waiting-offline',
    status: 'waiting',
    players: [
      { id: 'u1', username: 'A', online: false },
      { id: 'u2', username: 'B', online: false },
    ],
    createdAt: now - 10_000,
  })
  const waitingRoom = roomRepository.get('room-waiting-offline')
  waitingRoom.updatedAt = now - 10_000

  const removed = lifecycleService.cleanupExpiredRooms(now)
  assert.deepEqual(removed, ['room-waiting-offline'])
  assert.equal(roomRepository.get('room-waiting-offline'), null)
  assert.equal(lobbyBroadcaster.count, 1)
})

test('cleanupExpiredRooms should keep active waiting rooms', () => {
  const { roomRepository, lifecycleService, lobbyBroadcaster } = createLifecycleFixture()
  const now = Date.now()

  roomRepository.save({
    id: 'room-waiting-active',
    status: 'waiting',
    players: [{ id: 'u1', username: 'A', online: true }],
    createdAt: now - 10_000,
  })

  const removed = lifecycleService.cleanupExpiredRooms(now)
  assert.deepEqual(removed, [])
  assert.ok(roomRepository.get('room-waiting-active'))
  assert.equal(lobbyBroadcaster.count, 0)
})

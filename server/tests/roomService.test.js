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

test('leaveRoom should reject user that is not in target room', () => {
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

  assert.throws(
    () => roomService.leaveRoom(outsider, 'room-1'),
    /不在房间中/,
  )
})

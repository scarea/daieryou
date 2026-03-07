const test = require('node:test')
const assert = require('node:assert/strict')
const { RoomRepository } = require('../src/infrastructure/roomRepository')

test('roomRepository should mirror save/delete when mirror is attached', async () => {
  const calls = []
  const mirror = {
    async saveRoom(room) {
      calls.push({ type: 'save', roomId: room.id })
    },
    async deleteRoom(roomId) {
      calls.push({ type: 'delete', roomId })
    },
  }

  const repository = new RoomRepository({ roomMirror: mirror })
  repository.save({
    id: 'room-1',
    status: 'waiting',
    players: [],
  })
  repository.delete('room-1')

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(calls, [
    { type: 'save', roomId: 'room-1' },
    { type: 'delete', roomId: 'room-1' },
  ])
})

test('roomRepository should skip mirror hooks when requested', async () => {
  const calls = []
  const mirror = {
    async saveRoom(room) {
      calls.push({ type: 'save', roomId: room.id })
    },
    async deleteRoom(roomId) {
      calls.push({ type: 'delete', roomId })
    },
  }

  const repository = new RoomRepository({ roomMirror: mirror })
  repository.save({
    id: 'room-2',
    status: 'waiting',
    players: [],
  }, { skipMirror: true })
  repository.delete('room-2', { skipMirror: true })

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(calls, [])
})

test('roomRepository should load room from mirror by id', async () => {
  const mirror = {
    async loadRoom(roomId) {
      if (roomId !== 'room-3') {
        return null
      }

      return {
        id: roomId,
        status: 'waiting',
        players: [{ id: 'u1', username: 'A', online: true }],
      }
    },
  }

  const repository = new RoomRepository({ roomMirror: mirror })
  const loaded = await repository.loadRoomFromMirror('room-3')

  assert.ok(loaded)
  assert.equal(repository.get('room-3')?.id, 'room-3')
})

test('roomRepository should sync missing rooms from mirror', async () => {
  const mirror = {
    async listRooms() {
      return [
        { id: 'room-4', status: 'waiting', players: [] },
        { id: 'room-5', status: 'finished', players: [] },
      ]
    },
  }

  const repository = new RoomRepository({ roomMirror: mirror })
  repository.save({ id: 'room-5', status: 'waiting', players: [] }, { skipMirror: true })

  const result = await repository.syncFromMirror({ onlyMissing: true })
  assert.deepEqual(result, { enabled: true, restored: 1 })
  assert.equal(repository.get('room-4')?.id, 'room-4')
  assert.equal(repository.get('room-5')?.status, 'waiting')
})

test('roomRepository should overwrite existing rooms when syncFromMirror onlyMissing=false', async () => {
  const mirror = {
    async listRooms() {
      return [
        { id: 'room-6', status: 'finished', players: [] },
      ]
    },
  }

  const repository = new RoomRepository({ roomMirror: mirror })
  repository.save({ id: 'room-6', status: 'waiting', players: [] }, { skipMirror: true })

  const result = await repository.syncFromMirror({ onlyMissing: false })
  assert.deepEqual(result, { enabled: true, restored: 1 })
  assert.equal(repository.get('room-6')?.status, 'finished')
})

test('roomRepository should evict finished rooms first when capacity is exceeded', async () => {
  const mirrorDeleteCalls = []
  const repository = new RoomRepository({
    maxInMemoryRooms: 1,
    roomMirror: {
      async saveRoom() {},
      async deleteRoom(roomId) {
        mirrorDeleteCalls.push(roomId)
      },
    },
  })

  repository.save({
    id: 'room-finished',
    status: 'finished',
    players: [],
  })
  repository.save({
    id: 'room-playing',
    status: 'playing',
    players: [{ id: 'u1', online: true }],
  })

  assert.equal(repository.get('room-finished'), null)
  assert.ok(repository.get('room-playing'))
  assert.deepEqual(mirrorDeleteCalls, [])
})

test('roomRepository should evict oldest room when priorities are same', async () => {
  const repository = new RoomRepository({ maxInMemoryRooms: 1 })

  repository.save({
    id: 'room-a',
    status: 'waiting',
    players: [{ id: 'u1', online: true }],
  })
  repository.save({
    id: 'room-b',
    status: 'waiting',
    players: [{ id: 'u2', online: true }],
  })

  assert.equal(repository.get('room-a'), null)
  assert.ok(repository.get('room-b'))
})

test('roomRepository should enqueue mirror save failure and retry later', async () => {
  let shouldFail = true
  const savedRoomIds = []
  const repository = new RoomRepository({
    roomMirror: {
      async saveRoom(room) {
        if (shouldFail) {
          throw new Error('mirror unavailable')
        }
        savedRoomIds.push(room.id)
      },
      async deleteRoom() {},
    },
  })

  repository.save({
    id: 'room-retry-save',
    status: 'waiting',
    players: [],
  })

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(repository.getPendingMirrorOpsCount(), 1)

  shouldFail = false
  const retryResult = await repository.retryPendingMirrorOps({ maxOps: 10 })
  assert.deepEqual(retryResult, { retried: 1, failed: 0, remaining: 0 })
  assert.deepEqual(savedRoomIds, ['room-retry-save'])
})

test('roomRepository should enqueue mirror delete failure and retry later', async () => {
  let shouldFail = true
  const deletedRoomIds = []
  const repository = new RoomRepository({
    roomMirror: {
      async saveRoom() {},
      async deleteRoom(roomId) {
        if (shouldFail) {
          throw new Error('mirror unavailable')
        }
        deletedRoomIds.push(roomId)
      },
    },
  })

  repository.save({
    id: 'room-retry-delete',
    status: 'waiting',
    players: [],
  }, { skipMirror: true })
  repository.delete('room-retry-delete')

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(repository.getPendingMirrorOpsCount(), 1)

  shouldFail = false
  const retryResult = await repository.retryPendingMirrorOps({ maxOps: 10 })
  assert.deepEqual(retryResult, { retried: 1, failed: 0, remaining: 0 })
  assert.deepEqual(deletedRoomIds, ['room-retry-delete'])
})

test('roomRepository should enqueue mirror op when mirror returns false', async () => {
  const repository = new RoomRepository({
    roomMirror: {
      async saveRoom() {
        return false
      },
      async deleteRoom() {
        return false
      },
    },
  })

  repository.save({
    id: 'room-false-save',
    status: 'waiting',
    players: [],
  })
  repository.delete('room-false-save')

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(repository.getPendingMirrorOpsCount(), 1)

  const retryResult = await repository.retryPendingMirrorOps({ maxOps: 10 })
  assert.deepEqual(retryResult, { retried: 0, failed: 1, remaining: 1 })
})

test('roomRepository saveWithMode should await mirror first in primary mode', async () => {
  let resolved = false
  const repository = new RoomRepository({
    primaryMirrorWrites: true,
    roomMirror: {
      async saveRoom() {
        await new Promise((resolve) => setTimeout(resolve, 10))
        resolved = true
        return true
      },
      async deleteRoom() {
        return true
      },
    },
  })

  const savePromise = repository.saveWithMode({
    id: 'room-primary-save',
    status: 'waiting',
    players: [],
  })

  assert.equal(repository.get('room-primary-save'), null)
  await savePromise
  assert.equal(resolved, true)
  assert.equal(repository.get('room-primary-save')?.id, 'room-primary-save')
})

test('roomRepository saveWithMode should fallback local and enqueue when mirror fails in primary mode', async () => {
  const repository = new RoomRepository({
    primaryMirrorWrites: true,
    roomMirror: {
      async saveRoom() {
        return false
      },
      async deleteRoom() {
        return true
      },
    },
  })

  await repository.saveWithMode({
    id: 'room-primary-save-fallback',
    status: 'waiting',
    players: [],
  })

  assert.equal(repository.get('room-primary-save-fallback')?.id, 'room-primary-save-fallback')
  assert.equal(repository.getPendingMirrorOpsCount(), 1)
})

test('roomRepository deleteWithMode should await mirror first in primary mode', async () => {
  let mirrorDeleteResolved = false
  const repository = new RoomRepository({
    primaryMirrorWrites: true,
    roomMirror: {
      async saveRoom() {
        return true
      },
      async deleteRoom() {
        await new Promise((resolve) => setTimeout(resolve, 10))
        mirrorDeleteResolved = true
        return true
      },
    },
  })

  repository.save({
    id: 'room-primary-delete',
    status: 'waiting',
    players: [],
  }, { skipMirror: true })

  const deletePromise = repository.deleteWithMode('room-primary-delete')
  assert.equal(repository.get('room-primary-delete')?.id, 'room-primary-delete')
  await deletePromise
  assert.equal(mirrorDeleteResolved, true)
  assert.equal(repository.get('room-primary-delete'), null)
})

test('roomRepository deleteWithMode should fallback local and enqueue when mirror fails in primary mode', async () => {
  const repository = new RoomRepository({
    primaryMirrorWrites: true,
    roomMirror: {
      async saveRoom() {
        return true
      },
      async deleteRoom() {
        return false
      },
    },
  })

  repository.save({
    id: 'room-primary-delete-fallback',
    status: 'waiting',
    players: [],
  }, { skipMirror: true })

  await repository.deleteWithMode('room-primary-delete-fallback')
  assert.equal(repository.get('room-primary-delete-fallback'), null)
  assert.equal(repository.getPendingMirrorOpsCount(), 1)
})

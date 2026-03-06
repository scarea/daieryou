const test = require('node:test')
const assert = require('node:assert/strict')
const { RedisRoomMirror } = require('../src/infrastructure/redisRoomMirror')
const { RoomRepository } = require('../src/infrastructure/roomRepository')

function createFakeRedisClient() {
  const kv = new Map()
  const sets = new Map()

  function getSet(key) {
    if (!sets.has(key)) {
      sets.set(key, new Set())
    }

    return sets.get(key)
  }

  const client = {
    isReady: false,
    on() {},
    async connect() {
      this.isReady = true
    },
    async disconnect() {
      this.isReady = false
    },
    async quit() {
      this.isReady = false
    },
    async sMembers(key) {
      return Array.from(getSet(key))
    },
    async get(key) {
      return kv.get(key) ?? null
    },
    async sRem(key, value) {
      getSet(key).delete(value)
      return 1
    },
    async del(key) {
      kv.delete(key)
      return 1
    },
    multi() {
      const operations = []
      return {
        sAdd(key, value) {
          operations.push(() => getSet(key).add(value))
          return this
        },
        set(key, value) {
          operations.push(() => kv.set(key, value))
          return this
        },
        del(key) {
          operations.push(() => kv.delete(key))
          return this
        },
        sRem(key, value) {
          operations.push(() => getSet(key).delete(value))
          return this
        },
        async exec() {
          operations.forEach((operation) => operation())
          return []
        },
      }
    },
    __kv: kv,
    __sets: sets,
  }

  return client
}

test('redisRoomMirror should stay disabled when redisUri is empty', async () => {
  const mirror = new RedisRoomMirror({ redisUri: '' })
  const roomRepository = new RoomRepository()
  const result = await mirror.restoreToRepository(roomRepository)

  assert.deepEqual(result, { enabled: false, restored: 0 })
  assert.equal(await mirror.saveRoom({ id: 'room-a' }), false)
  assert.equal(await mirror.deleteRoom('room-a'), false)
})

test('redisRoomMirror should save and delete room snapshots when enabled', async () => {
  const fakeClient = createFakeRedisClient()
  const mirror = new RedisRoomMirror({
    redisUri: 'redis://local',
    createRedisClient: () => fakeClient,
    keyPrefix: 'test:mirror',
    snapshotTtlMs: 1000,
  })

  await mirror.saveRoom({
    id: 'room-1',
    status: 'waiting',
    players: [],
  })

  assert.equal(fakeClient.__sets.get('test:mirror:ids').has('room-1'), true)
  assert.equal(typeof fakeClient.__kv.get('test:mirror:room:room-1'), 'string')

  await mirror.deleteRoom('room-1')
  assert.equal(fakeClient.__sets.get('test:mirror:ids').has('room-1'), false)
  assert.equal(fakeClient.__kv.has('test:mirror:room:room-1'), false)
})

test('redisRoomMirror should restore valid rooms and cleanup invalid payloads', async () => {
  const fakeClient = createFakeRedisClient()
  const roomIdsKey = 'test:restore:ids'
  fakeClient.__sets.set(roomIdsKey, new Set(['room-valid', 'room-bad-json', 'room-missing']))
  fakeClient.__kv.set('test:restore:room:room-valid', JSON.stringify({
    id: 'room-valid',
    status: 'waiting',
    players: [{ id: 'u1', username: 'A', online: true }],
    hostId: 'u1',
    createdAt: Date.now(),
  }))
  fakeClient.__kv.set('test:restore:room:room-bad-json', '{not-json}')

  const mirror = new RedisRoomMirror({
    redisUri: 'redis://local',
    createRedisClient: () => fakeClient,
    keyPrefix: 'test:restore',
  })
  const roomRepository = new RoomRepository()
  const result = await mirror.restoreToRepository(roomRepository)

  assert.deepEqual(result, { enabled: true, restored: 1 })
  assert.ok(roomRepository.get('room-valid'))
  assert.equal(roomRepository.get('room-bad-json'), null)
  assert.equal(roomRepository.get('room-missing'), null)
  assert.equal(fakeClient.__sets.get(roomIdsKey).has('room-bad-json'), false)
  assert.equal(fakeClient.__sets.get(roomIdsKey).has('room-missing'), false)
})

test('redisRoomMirror loadRoom should return null for invalid payload and cleanup ids', async () => {
  const fakeClient = createFakeRedisClient()
  const idsKey = 'test:load:ids'
  fakeClient.__sets.set(idsKey, new Set(['room-load']))
  fakeClient.__kv.set('test:load:room:room-load', '{bad-json}')

  const mirror = new RedisRoomMirror({
    redisUri: 'redis://local',
    createRedisClient: () => fakeClient,
    keyPrefix: 'test:load',
  })

  const room = await mirror.loadRoom('room-load')
  assert.equal(room, null)
  assert.equal(fakeClient.__sets.get(idsKey).has('room-load'), false)
  assert.equal(fakeClient.__kv.has('test:load:room:room-load'), false)
})

test('redisRoomMirror listRooms should return valid rooms only', async () => {
  const fakeClient = createFakeRedisClient()
  const idsKey = 'test:list:ids'
  fakeClient.__sets.set(idsKey, new Set(['room-a', 'room-b']))
  fakeClient.__kv.set('test:list:room:room-a', JSON.stringify({
    id: 'room-a',
    status: 'waiting',
    players: [],
  }))
  fakeClient.__kv.set('test:list:room:room-b', '{bad-json}')

  const mirror = new RedisRoomMirror({
    redisUri: 'redis://local',
    createRedisClient: () => fakeClient,
    keyPrefix: 'test:list',
  })

  const rooms = await mirror.listRooms()
  assert.equal(rooms.length, 1)
  assert.equal(rooms[0].id, 'room-a')
  assert.equal(fakeClient.__sets.get(idsKey).has('room-b'), false)
})

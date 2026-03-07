const test = require('node:test')
const assert = require('node:assert/strict')
const { AuthService } = require('../src/application/authService')

function createSession(id) {
  const data = {}
  return {
    id,
    set(key, value) {
      data[key] = value
    },
    get(key) {
      return data[key]
    },
    push(key, cb) {
      if (cb) {
        cb()
      }
    },
  }
}

function createAuthService(maxUserProfiles = 2) {
  return new AuthService({
    sessionRepository: {
      bindUser() {},
    },
    roomService: {
      setUserOnline() {
        return null
      },
      setUserOffline() {},
      cleanupUserFromRooms() {},
    },
    roomRepository: {
      findByUserId() {
        return null
      },
    },
    lobbyBroadcaster: {
      buildRoomList() {
        return []
      },
    },
    disconnectGraceMs: 10,
    maxUserProfiles,
    sessionTokenSecret: 'test-secret',
    sessionTokenTtlMs: 60_000,
  })
}

test('login should reject too long username', async () => {
  const service = createAuthService()
  const session = createSession('s-1')

  await assert.rejects(
    () => service.login('x'.repeat(25), session),
    /用户名不能超过24个字符/,
  )
})

test('login should reject invalid session token', async () => {
  const service = createAuthService()
  const session = createSession('s-2')

  await assert.rejects(
    () => service.login('Tester', session, 'bad-token'),
    /会话已失效，请重新登录/,
  )
})

test('userProfiles should keep bounded size', async () => {
  const service = createAuthService(2)

  const token1 = service.issueSessionToken('u1')
  const token2 = service.issueSessionToken('u2')
  const token3 = service.issueSessionToken('u3')

  await service.login('A', createSession('s-3'), token1)
  await service.login('B', createSession('s-4'), token2)
  await service.login('C', createSession('s-5'), token3)

  assert.equal(service.userProfiles.size, 2)
  assert.equal(service.userProfiles.has('u1'), false)
  assert.equal(service.userProfiles.has('u2'), true)
  assert.equal(service.userProfiles.has('u3'), true)
})

test('login should keep same userId when session token is valid', async () => {
  const service = createAuthService(2)
  const firstLogin = await service.login('Tester', createSession('s-6'))
  const secondLogin = await service.login('Tester', createSession('s-7'), firstLogin.sessionToken)

  assert.equal(secondLogin.user.id, firstLogin.user.id)
  assert.equal(typeof secondLogin.sessionToken, 'string')
  assert.ok(secondLogin.sessionToken.length > 20)
})

test('login without session token should create different user ids', async () => {
  const service = createAuthService(2)
  const firstLogin = await service.login('A', createSession('s-8'))
  const secondLogin = await service.login('A', createSession('s-9'))

  assert.notEqual(firstLogin.user.id, secondLogin.user.id)
})

test('login should include final round reveal when resuming a finished room', async () => {
  const finalRoundResult = {
    round: 5,
    playerResults: [
      { playerIndex: 0, playerName: 'Host', hand: [{ suit: 'spades', rank: 1 }], rank: 1 },
      { playerIndex: 1, playerName: 'B', hand: [{ suit: 'hearts', rank: 7 }], rank: 2 },
      { playerIndex: 2, playerName: 'C', hand: [{ suit: 'clubs', rank: 9 }], rank: 3 },
    ],
    loserIndex: 1,
    score: 5,
  }
  const room = {
    id: 'room-finished-1',
    hostId: 'u1',
    status: 'finished',
    createdAt: Date.now(),
    players: [
      { id: 'u1', username: 'Host', score: 1000, online: true },
      { id: 'u2', username: 'B', score: 1000, online: true },
      { id: 'u3', username: 'C', score: 1000, online: true },
    ],
    gameState: null,
    finalScores: [
      { playerId: 'u1', username: 'Host', totalScore: 6, roundScores: [1, 1, 1, 1, 2] },
      { playerId: 'u2', username: 'B', totalScore: -6, roundScores: [-2, -2, -2] },
      { playerId: 'u3', username: 'C', totalScore: 0, roundScores: [1, 1, 1, 1, -4] },
    ],
    finalRoundResult,
    finishedAt: Date.now(),
  }

  const service = new AuthService({
    sessionRepository: {
      bindUser() {},
    },
    roomService: {
      setUserOnline() {
        return room
      },
      setUserOffline() {},
      cleanupUserFromRooms() {},
    },
    roomRepository: {
      findByUserId(userId) {
        return userId === 'u1' ? room : null
      },
    },
    lobbyBroadcaster: {
      buildRoomList() {
        return []
      },
    },
    disconnectGraceMs: 10,
    maxUserProfiles: 2,
    sessionTokenSecret: 'test-secret',
    sessionTokenTtlMs: 60_000,
  })

  const payload = await service.login('Host', createSession('s-10'), service.issueSessionToken('u1'))

  assert.equal(Array.isArray(payload.finalScores), true)
  assert.equal(payload.finalScores.length, 3)
  assert.deepEqual(payload.finalRoundResult, finalRoundResult)
  assert.equal(payload.finalRoundResult.playerResults.length, 3)
})

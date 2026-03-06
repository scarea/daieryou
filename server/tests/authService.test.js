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

test('login should reject too long username', () => {
  const service = createAuthService()
  const session = createSession('s-1')

  assert.throws(
    () => service.login('x'.repeat(25), session),
    /用户名不能超过24个字符/,
  )
})

test('login should reject invalid session token', () => {
  const service = createAuthService()
  const session = createSession('s-2')

  assert.throws(
    () => service.login('Tester', session, 'bad-token'),
    /会话已失效，请重新登录/,
  )
})

test('userProfiles should keep bounded size', () => {
  const service = createAuthService(2)

  const token1 = service.issueSessionToken('u1')
  const token2 = service.issueSessionToken('u2')
  const token3 = service.issueSessionToken('u3')

  service.login('A', createSession('s-3'), token1)
  service.login('B', createSession('s-4'), token2)
  service.login('C', createSession('s-5'), token3)

  assert.equal(service.userProfiles.size, 2)
  assert.equal(service.userProfiles.has('u1'), false)
  assert.equal(service.userProfiles.has('u2'), true)
  assert.equal(service.userProfiles.has('u3'), true)
})

test('login should keep same userId when session token is valid', () => {
  const service = createAuthService(2)
  const firstLogin = service.login('Tester', createSession('s-6'))
  const secondLogin = service.login('Tester', createSession('s-7'), firstLogin.sessionToken)

  assert.equal(secondLogin.user.id, firstLogin.user.id)
  assert.equal(typeof secondLogin.sessionToken, 'string')
  assert.ok(secondLogin.sessionToken.length > 20)
})

test('login without session token should create different user ids', () => {
  const service = createAuthService(2)
  const firstLogin = service.login('A', createSession('s-8'))
  const secondLogin = service.login('A', createSession('s-9'))

  assert.notEqual(firstLogin.user.id, secondLogin.user.id)
})

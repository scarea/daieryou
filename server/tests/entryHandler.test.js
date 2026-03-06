const test = require('node:test')
const assert = require('node:assert/strict')

const { appContext } = require('../src/application/appContext')
const createEntryHandler = require('../app/servers/connector/handler/entryHandler')

test('entryHandler register should forward inviteCode to accountAuthService', async () => {
  const handler = createEntryHandler()
  const session = {}
  const originalRegister = appContext.accountAuthService.register
  const captured = []

  appContext.accountAuthService.register = async (payload, incomingSession) => {
    captured.push({ payload, incomingSession })
    return { user: { id: 'u-1' } }
  }

  try {
    const result = await new Promise((resolve) => {
      handler.register({
        email: 'invite-handler@example.com',
        password: 'abc12345',
        verificationCode: '123456',
        username: 'InviteHandler',
        inviteCode: 'INVTEST1',
      }, session, (err, body) => resolve({ err, body }))
    })

    assert.equal(result.err, null)
    assert.equal(result.body.code, 200)
    assert.equal(captured.length, 1)
    assert.equal(captured[0].payload.inviteCode, 'INVTEST1')
    assert.equal(captured[0].incomingSession, session)
  } finally {
    appContext.accountAuthService.register = originalRegister
  }
})

test('entryHandler purchaseMembership should forward planDays', async () => {
  const handler = createEntryHandler()
  const session = {
    get(key) {
      if (key === 'user') {
        return { id: 'member-user' }
      }
      return null
    },
  }
  const originalPurchaseMembership = appContext.accountAuthService.purchaseMembership
  const captured = []

  appContext.accountAuthService.purchaseMembership = async (currentUser, payload) => {
    captured.push({ currentUser, payload })
    return { ok: true }
  }

  try {
    const result = await new Promise((resolve) => {
      handler.purchaseMembership({
        planDays: 90,
      }, session, (err, body) => resolve({ err, body }))
    })

    assert.equal(result.err, null)
    assert.equal(result.body.code, 200)
    assert.equal(captured.length, 1)
    assert.equal(captured[0].currentUser.id, 'member-user')
    assert.equal(captured[0].payload.planDays, 90)
  } finally {
    appContext.accountAuthService.purchaseMembership = originalPurchaseMembership
  }
})

test('entryHandler adminDisableInviteCode should forward code and reason', async () => {
  const handler = createEntryHandler()
  const session = {
    get(key) {
      if (key === 'user') {
        return { id: 'admin-user' }
      }
      return null
    },
  }
  const originalAdminDisableInviteCode = appContext.accountAuthService.adminDisableInviteCode
  const captured = []

  appContext.accountAuthService.adminDisableInviteCode = async (currentUser, payload) => {
    captured.push({ currentUser, payload })
    return { ok: true }
  }

  try {
    const result = await new Promise((resolve) => {
      handler.adminDisableInviteCode({
        code: 'INV12345',
        reason: 'risk',
      }, session, (err, body) => resolve({ err, body }))
    })

    assert.equal(result.err, null)
    assert.equal(result.body.code, 200)
    assert.equal(captured.length, 1)
    assert.equal(captured[0].currentUser.id, 'admin-user')
    assert.equal(captured[0].payload.code, 'INV12345')
    assert.equal(captured[0].payload.reason, 'risk')
  } finally {
    appContext.accountAuthService.adminDisableInviteCode = originalAdminDisableInviteCode
  }
})

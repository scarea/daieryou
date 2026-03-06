const test = require('node:test')
const assert = require('node:assert/strict')
const { AccountAuthService } = require('../src/application/accountAuthService')

function createSession() {
  const data = {}
  return {
    set(key, value) {
      data[key] = value
    },
    get(key) {
      return data[key]
    },
  }
}

function createFixture() {
  const accounts = new Map()
  const normalizeEmail = (email) => String(email || '').trim().toLowerCase()
  const accountRepository = {
    async findByEmail(email) {
      return accounts.get(normalizeEmail(email)) || null
    },
    async findByUserId(userId) {
      for (const account of accounts.values()) {
        if (account.userId === userId) {
          return account
        }
      }
      return null
    },
    async create(account) {
      const key = normalizeEmail(account?.email)
      if (accounts.has(key)) {
        throw new Error('该邮箱已注册')
      }
      const nextAccount = { ...account, email: key }
      accounts.set(key, nextAccount)
      return nextAccount
    },
    async updateByEmail(email, updates) {
      const key = normalizeEmail(email)
      const previous = accounts.get(key)
      if (!previous) {
        return null
      }
      const nextAccount = { ...previous, ...updates, email: key }
      accounts.set(key, nextAccount)
      return nextAccount
    },
  }
  const inviteCodes = new Map()
  const inviteCodeRepository = {
    async createInviteCode({
      code,
      creatorUserId,
      expiresAt,
      createdAt,
      channel = 'member',
      campaign = '',
      remark = '',
    }) {
      if (inviteCodes.has(code)) {
        const error = new Error('邀请码重复')
        error.code = 'INVITE_CODE_DUPLICATED'
        throw error
      }
      const inviteCode = {
        code,
        creatorUserId,
        status: 'active',
        expiresAt,
        usedCount: 0,
        maxUses: 1,
        channel,
        campaign,
        remark,
        disabledByUserId: null,
        disabledReason: null,
        createdAt,
        updatedAt: createdAt,
      }
      inviteCodes.set(code, inviteCode)
      return inviteCode
    },
    async findByCode(code) {
      return inviteCodes.get(code) || null
    },
    async consumeActiveCode(code, { userId, email, now }) {
      const inviteCode = inviteCodes.get(code)
      if (!inviteCode) {
        return null
      }
      if (inviteCode.status !== 'active' || inviteCode.expiresAt <= now || inviteCode.usedCount >= inviteCode.maxUses) {
        return null
      }
      const consumed = {
        ...inviteCode,
        status: 'used',
        usedCount: inviteCode.usedCount + 1,
        usedByUserId: userId || null,
        usedByEmail: email || null,
        usedAt: now,
        updatedAt: now,
      }
      inviteCodes.set(code, consumed)
      return consumed
    },
    async rollbackConsume(code, { now }) {
      const inviteCode = inviteCodes.get(code)
      if (!inviteCode) {
        return null
      }
      const rolledBack = {
        ...inviteCode,
        status: 'active',
        usedCount: 0,
        usedByUserId: null,
        usedByEmail: null,
        usedAt: null,
        disabledByUserId: null,
        disabledReason: null,
        updatedAt: now,
      }
      inviteCodes.set(code, rolledBack)
      return rolledBack
    },
    async listInviteCodes({ limit = 50, status = null } = {}) {
      return Array.from(inviteCodes.values())
        .filter((inviteCode) => !status || inviteCode.status === status)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, limit)
    },
    async disableCode(code, { reason = '', disabledByUserId = null, now = Date.now() } = {}) {
      const inviteCode = inviteCodes.get(code)
      if (!inviteCode || inviteCode.status === 'disabled') {
        return null
      }

      const disabled = {
        ...inviteCode,
        status: 'disabled',
        disabledByUserId,
        disabledReason: reason || null,
        updatedAt: now,
      }
      inviteCodes.set(code, disabled)
      return disabled
    },
  }
  const authService = {
    issueSessionToken(userId) {
      return `token-${userId}`
    },
    login(username, session, sessionToken) {
      const user = {
        id: sessionToken.replace('token-', ''),
        username,
        score: 1000,
      }
      session.set('user', user)
      return {
        user,
        room: null,
        gameState: null,
        finalScores: null,
        rooms: [],
        sessionToken,
      }
    },
  }
  const emailSender = {
    async sendVerificationCode() {
      return { delivered: true, delivery: 'console' }
    },
  }
  const service = new AccountAuthService({
    accountRepository,
    inviteCodeRepository,
    authService,
    emailSender,
    verificationCodeTtlMs: 60_000,
    sendCooldownMs: 1000,
    maxVerifyAttempts: 5,
    exposeDevCode: true,
    codeHashSecret: 'unit-test-secret',
  })

  return {
    service,
    accountRepository,
    inviteCodeRepository,
  }
}

test('account auth should send verification code and register account', async () => {
  const { service, accountRepository } = createFixture()
  const session = createSession()
  const sendResult = await service.sendEmailCode('tester@example.com')
  assert.equal(sendResult.success, true)
  assert.equal(sendResult.delivery, 'console')
  assert.match(sendResult.debugCode, /^\d{6}$/)

  const registerPayload = await service.register({
    email: 'tester@example.com',
    password: 'abc12345',
    verificationCode: sendResult.debugCode,
    username: 'Tester',
  }, session)

  assert.equal(registerPayload.user.username, 'Tester')
  assert.equal(typeof registerPayload.sessionToken, 'string')
  const account = await accountRepository.findByEmail('tester@example.com')
  assert.equal(account.username, 'Tester')
  assert.ok(account.passwordHash)
  assert.ok(account.passwordSalt)
})

test('account auth should login with password after registration', async () => {
  const { service } = createFixture()
  const registerSession = createSession()
  const sendResult = await service.sendEmailCode('login@example.com')
  await service.register({
    email: 'login@example.com',
    password: 'abc12345',
    verificationCode: sendResult.debugCode,
    username: 'LoginUser',
  }, registerSession)

  const loginSession = createSession()
  const loginPayload = await service.loginWithPassword({
    email: 'login@example.com',
    password: 'abc12345',
  }, loginSession)

  assert.equal(loginPayload.user.username, 'LoginUser')
  assert.equal(loginPayload.account.email, 'login@example.com')

  await assert.rejects(
    () => service.loginWithPassword({ email: 'login@example.com', password: 'wrong-pass-1' }, createSession()),
    /账号或密码错误/,
  )
})

test('account auth should require invite code when inviteRequired is enabled', async () => {
  const { service, inviteCodeRepository } = createFixture()
  service.inviteRequired = true

  await inviteCodeRepository.createInviteCode({
    code: 'INV12345',
    creatorUserId: 'member-1',
    expiresAt: Date.now() + 60_000,
    createdAt: Date.now(),
  })

  const sendResult = await service.sendEmailCode('invite@example.com')
  await assert.rejects(
    () => service.register({
      email: 'invite@example.com',
      password: 'abc12345',
      verificationCode: sendResult.debugCode,
      username: 'InviteUser',
    }, createSession()),
    /邀请码不能为空/,
  )

  const payload = await service.register({
    email: 'invite@example.com',
    password: 'abc12345',
    verificationCode: sendResult.debugCode,
    username: 'InviteUser',
    inviteCode: 'INV12345',
  }, createSession())

  assert.equal(payload.user.username, 'InviteUser')
})

test('account auth should rollback invite code when verification code is invalid', async () => {
  const { service, inviteCodeRepository } = createFixture()

  await inviteCodeRepository.createInviteCode({
    code: 'INV67890',
    creatorUserId: 'member-2',
    expiresAt: Date.now() + 60_000,
    createdAt: Date.now(),
  })

  await service.sendEmailCode('rollback@example.com')

  await assert.rejects(
    () => service.register({
      email: 'rollback@example.com',
      password: 'abc12345',
      verificationCode: '000000',
      username: 'RollbackUser',
      inviteCode: 'INV67890',
    }, createSession()),
    /验证码错误/,
  )

  const inviteCode = await inviteCodeRepository.findByCode('INV67890')
  assert.equal(inviteCode.status, 'active')
  assert.equal(inviteCode.usedCount, 0)
})

test('account auth should purchase and renew membership', async () => {
  const { service, accountRepository } = createFixture()

  await accountRepository.create({
    email: 'buyer@example.com',
    userId: 'buyer-user',
    username: 'Buyer',
    passwordSalt: 'salt',
    passwordHash: 'hash',
    verifiedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isMember: false,
  })

  const firstPurchase = await service.purchaseMembership({ id: 'buyer-user' }, { planDays: 30 })
  assert.equal(firstPurchase.account.isMember, true)
  assert.ok(firstPurchase.expiresAt > Date.now())

  const renewed = await service.purchaseMembership({ id: 'buyer-user' }, { planDays: 30 })
  assert.ok(renewed.expiresAt > firstPurchase.expiresAt)
})

test('admin account should grant membership to target account', async () => {
  const { service, accountRepository } = createFixture()

  await accountRepository.create({
    email: 'admin@example.com',
    userId: 'admin-user',
    username: 'Admin',
    passwordSalt: 'salt',
    passwordHash: 'hash',
    verifiedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isAdmin: true,
  })

  await accountRepository.create({
    email: 'target@example.com',
    userId: 'target-user',
    username: 'Target',
    passwordSalt: 'salt',
    passwordHash: 'hash',
    verifiedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isMember: false,
  })

  const granted = await service.adminGrantMembership(
    { id: 'admin-user' },
    { targetEmail: 'target@example.com', durationDays: 90, reason: 'campaign' },
  )

  assert.equal(granted.account.email, 'target@example.com')
  assert.equal(granted.account.isMember, true)
  assert.ok(granted.expiresAt > Date.now())
})

test('admin account should list and disable invite codes', async () => {
  const { service, accountRepository, inviteCodeRepository } = createFixture()

  await accountRepository.create({
    email: 'admin2@example.com',
    userId: 'admin-user-2',
    username: 'Admin2',
    passwordSalt: 'salt',
    passwordHash: 'hash',
    verifiedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isAdmin: true,
  })

  await inviteCodeRepository.createInviteCode({
    code: 'OPS12345',
    creatorUserId: 'admin-user-2',
    expiresAt: Date.now() + 60_000,
    channel: 'campaign',
    campaign: 'spring-1',
    remark: 'seed-users',
    createdAt: Date.now(),
  })

  const listed = await service.adminListInviteCodes({ id: 'admin-user-2' }, { limit: 10 })
  assert.equal(Array.isArray(listed.inviteCodes), true)
  assert.equal(listed.inviteCodes[0].code, 'OPS12345')

  const disabled = await service.adminDisableInviteCode(
    { id: 'admin-user-2' },
    { code: 'OPS12345', reason: 'risk-control' },
  )

  assert.equal(disabled.inviteCode.status, 'disabled')
  assert.equal(disabled.inviteCode.disabledReason, 'risk-control')
})

test('non-admin account should not grant membership or manage invite codes', async () => {
  const { service, accountRepository } = createFixture()

  await accountRepository.create({
    email: 'normal-admin-check@example.com',
    userId: 'normal-admin-check',
    username: 'NormalAdminCheck',
    passwordSalt: 'salt',
    passwordHash: 'hash',
    verifiedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isAdmin: false,
  })

  await assert.rejects(
    () => service.adminGrantMembership(
      { id: 'normal-admin-check' },
      { targetEmail: 'target@example.com', durationDays: 30 },
    ),
    /仅管理员可执行该操作/,
  )

  await assert.rejects(
    () => service.adminListInviteCodes({ id: 'normal-admin-check' }, { limit: 10 }),
    /仅管理员可执行该操作/,
  )
})

test('member account should be able to create invite code', async () => {
  const { service, accountRepository } = createFixture()

  await accountRepository.create({
    email: 'member@example.com',
    userId: 'member-user',
    username: 'Member',
    passwordSalt: 'salt',
    passwordHash: 'hash',
    verifiedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isMember: true,
    memberExpiresAt: Date.now() + 60_000,
  })

  const inviteCode = await service.createInviteCode({ id: 'member-user' })
  assert.match(inviteCode.code, /^[A-Z0-9]+$/)
  assert.ok(inviteCode.expiresAt > Date.now())
})

test('non-member user should not create invite code', async () => {
  const { service, accountRepository } = createFixture()

  await accountRepository.create({
    email: 'normal@example.com',
    userId: 'normal-user',
    username: 'Normal',
    passwordSalt: 'salt',
    passwordHash: 'hash',
    verifiedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isMember: false,
  })

  await assert.rejects(
    () => service.createInviteCode({ id: 'normal-user' }),
    /仅会员用户可生成邀请码/,
  )
})

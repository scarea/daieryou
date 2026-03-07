const crypto = require('node:crypto')
const { v4: uuidv4 } = require('uuid')

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 72
const MAX_USERNAME_LENGTH = 24
const MIN_INVITE_CODE_LENGTH = 6
const MAX_INVITE_CODE_LENGTH = 16
const INVITE_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MIN_MEMBERSHIP_DAYS = 1
const MAX_MEMBERSHIP_DAYS = 3650
const DEFAULT_MEMBER_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

class AccountAuthService {
  constructor({
    accountRepository,
    inviteCodeRepository = null,
    adminAuditRepository = null,
    authService,
    emailSender,
    emailEnabled = true,
    inviteRequired = false,
    inviteCodeTtlMs = 7 * 24 * 60 * 60 * 1000,
    inviteCodeLength = 8,
    memberDefaultDays = DEFAULT_MEMBER_DAYS,
    adminEmails = [],
    adminInviteListLimit = 50,
    adminAuditListLimit = 50,
    verificationCodeTtlMs = 10 * 60 * 1000,
    sendCooldownMs = 60 * 1000,
    maxVerifyAttempts = 5,
    exposeDevCode = false,
    codeHashSecret = 'daieryou-email-code-secret',
  }) {
    this.accountRepository = accountRepository
    this.inviteCodeRepository = inviteCodeRepository
    this.adminAuditRepository = adminAuditRepository
    this.authService = authService
    this.emailSender = emailSender
    this.emailEnabled = emailEnabled !== false
    this.inviteRequired = inviteRequired === true
    this.inviteCodeTtlMs = Number.isFinite(inviteCodeTtlMs) && inviteCodeTtlMs > 0
      ? inviteCodeTtlMs
      : 7 * 24 * 60 * 60 * 1000
    this.inviteCodeLength = Math.max(
      MIN_INVITE_CODE_LENGTH,
      Math.min(MAX_INVITE_CODE_LENGTH, Math.floor(Number(inviteCodeLength) || 8)),
    )
    this.memberDefaultDays = this.normalizeMembershipDays(memberDefaultDays, DEFAULT_MEMBER_DAYS)
    this.adminEmails = new Set(
      Array.isArray(adminEmails)
        ? adminEmails
          .map((email) => this.normalizeEmail(email))
          .filter(Boolean)
        : [],
    )
    this.adminInviteListLimit = Math.max(10, Math.min(200, Math.floor(Number(adminInviteListLimit) || 50)))
    this.adminAuditListLimit = Math.max(10, Math.min(200, Math.floor(Number(adminAuditListLimit) || 50)))
    this.verificationCodeTtlMs = verificationCodeTtlMs
    this.sendCooldownMs = sendCooldownMs
    this.maxVerifyAttempts = maxVerifyAttempts
    this.exposeDevCode = exposeDevCode
    this.codeHashSecret = codeHashSecret
    this.verificationCodes = new Map()
  }

  normalizeEmail(email) {
    if (typeof email !== 'string') {
      return ''
    }

    return email.trim().toLowerCase()
  }

  normalizeInviteCode(code) {
    if (typeof code !== 'string') {
      return ''
    }

    return code.trim().toUpperCase()
  }

  normalizeMembershipDays(days, fallbackDays = this.memberDefaultDays || DEFAULT_MEMBER_DAYS) {
    const parsed = Math.floor(Number(days))
    if (!Number.isFinite(parsed) || parsed < MIN_MEMBERSHIP_DAYS || parsed > MAX_MEMBERSHIP_DAYS) {
      return fallbackDays
    }

    return parsed
  }

  normalizeInviteMeta(meta = {}) {
    return {
      channel: typeof meta.channel === 'string' ? meta.channel.trim().slice(0, 32) : '',
      campaign: typeof meta.campaign === 'string' ? meta.campaign.trim().slice(0, 64) : '',
      remark: typeof meta.remark === 'string' ? meta.remark.trim().slice(0, 120) : '',
    }
  }

  assertEmailEnabled() {
    if (!this.emailEnabled) {
      throw new Error('邮箱登录未开启')
    }
  }

  isAdminAccount(account) {
    if (!account) {
      return false
    }

    if (account.isAdmin === true) {
      return true
    }

    const normalizedEmail = this.normalizeEmail(account.email)
    return normalizedEmail ? this.adminEmails.has(normalizedEmail) : false
  }

  toPublicAccount(account) {
    if (!account) {
      return null
    }

    const now = Date.now()
    const isMember = this.isMemberAccount(account, now)
    const expiresAt = Number.isFinite(account.memberExpiresAt) ? account.memberExpiresAt : null
    const memberDaysRemaining = isMember && expiresAt
      ? Math.max(1, Math.ceil((expiresAt - now) / DAY_MS))
      : 0

    return {
      email: account.email,
      username: account.username,
      isMember,
      isAdmin: this.isAdminAccount(account),
      memberExpiresAt: expiresAt,
      memberDaysRemaining,
    }
  }

  isMemberAccount(account, now = Date.now()) {
    if (!account || account.isMember !== true) {
      return false
    }

    if (!account.memberExpiresAt) {
      return true
    }

    return account.memberExpiresAt > now
  }

  assertAdminAccount(account) {
    if (!account || !this.isAdminAccount(account)) {
      throw new Error('仅管理员可执行该操作')
    }
  }

  toPublicInviteCode(inviteCode) {
    if (!inviteCode) {
      return null
    }

    return {
      code: inviteCode.code,
      creatorUserId: inviteCode.creatorUserId,
      channel: inviteCode.channel || 'member',
      campaign: inviteCode.campaign || '',
      remark: inviteCode.remark || '',
      status: inviteCode.status,
      expiresAt: inviteCode.expiresAt,
      usedCount: inviteCode.usedCount,
      maxUses: inviteCode.maxUses,
      usedByUserId: inviteCode.usedByUserId || null,
      usedByEmail: inviteCode.usedByEmail || null,
      usedAt: inviteCode.usedAt || null,
      disabledByUserId: inviteCode.disabledByUserId || null,
      disabledReason: inviteCode.disabledReason || null,
      createdAt: inviteCode.createdAt,
      updatedAt: inviteCode.updatedAt,
    }
  }

  toPublicAuditLog(log) {
    if (!log) {
      return null
    }

    return {
      action: log.action,
      actorUserId: log.actorUserId || null,
      actorEmail: log.actorEmail || null,
      targetUserId: log.targetUserId || null,
      targetEmail: log.targetEmail || null,
      source: log.source || 'system',
      detail: log.detail && typeof log.detail === 'object' ? log.detail : {},
      createdAt: log.createdAt,
    }
  }

  async writeAuditLog(payload) {
    if (!this.adminAuditRepository) {
      return null
    }

    try {
      return await this.adminAuditRepository.createLog(payload)
    } catch (error) {
      return null
    }
  }

  generateInviteCode() {
    let code = ''
    for (let index = 0; index < this.inviteCodeLength; index += 1) {
      const randomIndex = Math.floor(Math.random() * INVITE_CODE_CHARSET.length)
      code += INVITE_CODE_CHARSET[randomIndex]
    }

    return code
  }

  async getAuthConfig(currentUser) {
    const response = {
      emailEnabled: this.emailEnabled,
      inviteRequired: this.inviteRequired,
      inviteCodeLength: this.inviteCodeLength,
      memberDefaultDays: this.memberDefaultDays,
      adminInviteListLimit: this.adminInviteListLimit,
      adminAuditListLimit: this.adminAuditListLimit,
      currentAccount: null,
    }

    if (!currentUser?.id) {
      return response
    }

    try {
      const account = await this.accountRepository.findByUserId(currentUser.id)
      response.currentAccount = this.toPublicAccount(account)
    } catch (error) {
      response.currentAccount = null
    }

    return response
  }

  async createInviteCode(currentUser, options = {}) {
    this.assertEmailEnabled()
    if (!this.inviteCodeRepository) {
      throw new Error('邀请码服务未初始化')
    }
    if (!currentUser?.id) {
      throw new Error('用户未登录')
    }

    const account = await this.accountRepository.findByUserId(currentUser.id)
    if (!account) {
      throw new Error('仅账号用户可生成邀请码')
    }
    if (!this.isMemberAccount(account)) {
      throw new Error('仅会员用户可生成邀请码')
    }

    const now = Date.now()
    const expiresAt = now + this.inviteCodeTtlMs
    const inviteMeta = this.normalizeInviteMeta(options)

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = this.generateInviteCode()
      try {
        const inviteCode = await this.inviteCodeRepository.createInviteCode({
          code,
          creatorUserId: currentUser.id,
          expiresAt,
          maxUses: 1,
          channel: inviteMeta.channel || 'member',
          campaign: inviteMeta.campaign || '',
          remark: inviteMeta.remark || '',
          createdAt: now,
        })

        await this.writeAuditLog({
          action: 'invite.create',
          actorUserId: account.userId,
          actorEmail: account.email,
          targetUserId: null,
          targetEmail: null,
          source: 'member-self',
          detail: {
            code: inviteCode.code,
            channel: inviteMeta.channel || 'member',
            campaign: inviteMeta.campaign || '',
            remark: inviteMeta.remark || '',
            expiresAt,
          },
          createdAt: now,
        })

        return {
          code: inviteCode.code,
          expiresAt: inviteCode.expiresAt,
          expiresInSeconds: Math.ceil((inviteCode.expiresAt - now) / 1000),
        }
      } catch (error) {
        if (error?.code !== 'INVITE_CODE_DUPLICATED') {
          throw error
        }
      }
    }

    throw new Error('邀请码生成失败，请稍后重试')
  }

  async purchaseMembership(currentUser, { planDays = this.memberDefaultDays } = {}) {
    this.assertEmailEnabled()
    if (!currentUser?.id) {
      throw new Error('用户未登录')
    }

    const account = await this.accountRepository.findByUserId(currentUser.id)
    if (!account) {
      throw new Error('仅账号用户可开通会员')
    }

    const days = this.normalizeMembershipDays(planDays)
    const now = Date.now()
    const baseTimestamp = this.isMemberAccount(account, now) && Number.isFinite(account.memberExpiresAt)
      ? account.memberExpiresAt
      : now
    const nextExpiresAt = baseTimestamp + (days * DAY_MS)

    const updatedAccount = await this.accountRepository.updateByEmail(account.email, {
      isMember: true,
      memberExpiresAt: nextExpiresAt,
    })

    await this.writeAuditLog({
      action: 'membership.purchase',
      actorUserId: account.userId,
      actorEmail: account.email,
      targetUserId: account.userId,
      targetEmail: account.email,
      source: 'self-service',
      detail: {
        planDays: days,
        expiresAt: nextExpiresAt,
      },
      createdAt: now,
    })

    return {
      account: this.toPublicAccount(updatedAccount),
      planDays: days,
      expiresAt: nextExpiresAt,
      source: 'self-service',
    }
  }

  async adminGrantMembership(currentUser, { targetEmail, durationDays, reason = '' } = {}) {
    this.assertEmailEnabled()
    if (!currentUser?.id) {
      throw new Error('用户未登录')
    }

    const adminAccount = await this.accountRepository.findByUserId(currentUser.id)
    this.assertAdminAccount(adminAccount)

    const email = this.validateEmail(targetEmail)
    const targetAccount = await this.accountRepository.findByEmail(email)
    if (!targetAccount) {
      throw new Error('目标账号不存在')
    }

    const days = this.normalizeMembershipDays(durationDays)
    const now = Date.now()
    const baseTimestamp = this.isMemberAccount(targetAccount, now) && Number.isFinite(targetAccount.memberExpiresAt)
      ? targetAccount.memberExpiresAt
      : now
    const nextExpiresAt = baseTimestamp + (days * DAY_MS)

    const updatedAccount = await this.accountRepository.updateByEmail(email, {
      isMember: true,
      memberExpiresAt: nextExpiresAt,
    })

    await this.writeAuditLog({
      action: 'membership.grant',
      actorUserId: adminAccount.userId,
      actorEmail: adminAccount.email,
      targetUserId: targetAccount.userId,
      targetEmail: targetAccount.email,
      source: 'admin',
      detail: {
        planDays: days,
        expiresAt: nextExpiresAt,
        reason: typeof reason === 'string' ? reason.trim().slice(0, 120) : '',
      },
      createdAt: now,
    })

    return {
      account: this.toPublicAccount(updatedAccount),
      planDays: days,
      expiresAt: nextExpiresAt,
      reason: typeof reason === 'string' ? reason.trim().slice(0, 120) : '',
      source: 'admin-grant',
    }
  }

  async adminListInviteCodes(currentUser, { limit = this.adminInviteListLimit, status = null } = {}) {
    this.assertEmailEnabled()
    if (!this.inviteCodeRepository) {
      throw new Error('邀请码服务未初始化')
    }
    if (!currentUser?.id) {
      throw new Error('用户未登录')
    }

    const adminAccount = await this.accountRepository.findByUserId(currentUser.id)
    this.assertAdminAccount(adminAccount)

    const inviteCodes = await this.inviteCodeRepository.listInviteCodes({
      limit: Math.min(Math.max(1, Number(limit) || this.adminInviteListLimit), this.adminInviteListLimit),
      status,
    })

    return {
      inviteCodes: inviteCodes.map((inviteCode) => this.toPublicInviteCode(inviteCode)),
      limit: Math.min(Math.max(1, Number(limit) || this.adminInviteListLimit), this.adminInviteListLimit),
    }
  }

  async adminDisableInviteCode(currentUser, { code, reason = '' } = {}) {
    this.assertEmailEnabled()
    if (!this.inviteCodeRepository) {
      throw new Error('邀请码服务未初始化')
    }
    if (!currentUser?.id) {
      throw new Error('用户未登录')
    }

    const adminAccount = await this.accountRepository.findByUserId(currentUser.id)
    this.assertAdminAccount(adminAccount)

    const normalizedCode = this.normalizeInviteCode(code)
    if (!normalizedCode) {
      throw new Error('邀请码不能为空')
    }

    const disabled = await this.inviteCodeRepository.disableCode(normalizedCode, {
      reason,
      disabledByUserId: adminAccount.userId,
      now: Date.now(),
    })
    if (!disabled) {
      throw new Error('邀请码不存在或已被禁用')
    }

    await this.writeAuditLog({
      action: 'invite.disable',
      actorUserId: adminAccount.userId,
      actorEmail: adminAccount.email,
      targetUserId: disabled.creatorUserId || null,
      targetEmail: null,
      source: 'admin',
      detail: {
        code: disabled.code,
        reason: disabled.disabledReason || (typeof reason === 'string' ? reason.trim().slice(0, 120) : ''),
      },
      createdAt: Date.now(),
    })

    return {
      inviteCode: this.toPublicInviteCode(disabled),
    }
  }

  async adminListAuditLogs(currentUser, { limit = this.adminAuditListLimit, action = null } = {}) {
    this.assertEmailEnabled()
    if (!this.adminAuditRepository) {
      throw new Error('审计日志服务未初始化')
    }
    if (!currentUser?.id) {
      throw new Error('用户未登录')
    }

    const adminAccount = await this.accountRepository.findByUserId(currentUser.id)
    this.assertAdminAccount(adminAccount)

    const safeLimit = Math.min(Math.max(1, Number(limit) || this.adminAuditListLimit), this.adminAuditListLimit)
    const logs = await this.adminAuditRepository.listLogs({
      limit: safeLimit,
      action,
    })

    return {
      logs: logs.map((log) => this.toPublicAuditLog(log)),
      limit: safeLimit,
    }
  }

  async consumeInviteCode(rawInviteCode, { email, userId = null, now = Date.now() } = {}) {
    if (!this.inviteCodeRepository) {
      throw new Error('邀请码服务未初始化')
    }

    const inviteCode = this.normalizeInviteCode(rawInviteCode)
    if (!inviteCode) {
      throw new Error('邀请码不能为空')
    }

    const consumed = await this.inviteCodeRepository.consumeActiveCode(inviteCode, {
      userId,
      email,
      now,
    })
    if (consumed) {
      return consumed
    }

    const existing = await this.inviteCodeRepository.findByCode(inviteCode)
    if (!existing) {
      throw new Error('邀请码不存在')
    }
    if (existing.status !== 'active') {
      throw new Error('邀请码已使用或失效')
    }
    if (existing.expiresAt <= now) {
      throw new Error('邀请码已过期')
    }

    throw new Error('邀请码不可用')
  }

  validateEmail(email) {
    const normalizedEmail = this.normalizeEmail(email)
    if (!normalizedEmail || !EMAIL_PATTERN.test(normalizedEmail)) {
      throw new Error('邮箱格式不正确')
    }

    return normalizedEmail
  }

  validatePassword(password) {
    if (typeof password !== 'string') {
      throw new Error('密码不能为空')
    }

    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      throw new Error(`密码长度需在 ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} 位`)
    }

    const hasLetter = /[a-zA-Z]/.test(password)
    const hasNumber = /\d/.test(password)
    if (!hasLetter || !hasNumber) {
      throw new Error('密码需包含字母和数字')
    }
  }

  normalizeUsername(username, email) {
    if (typeof username === 'string' && username.trim()) {
      const trimmed = username.trim()
      if (trimmed.length > MAX_USERNAME_LENGTH) {
        throw new Error(`昵称不能超过${MAX_USERNAME_LENGTH}个字符`)
      }

      return trimmed
    }

    const localPart = email.split('@')[0] || ''
    const sanitized = localPart.replace(/[^\w\u4e00-\u9fa5]/g, '')
    if (sanitized.length > 0) {
      return sanitized.slice(0, MAX_USERNAME_LENGTH)
    }

    return `玩家${Math.floor(Math.random() * 10000)}`
  }

  generateVerificationCode() {
    return String(Math.floor(Math.random() * 900000) + 100000)
  }

  getVerificationKey(email) {
    return `register:${email}`
  }

  hashVerificationCode(email, code) {
    return crypto
      .createHmac('sha256', this.codeHashSecret)
      .update(`${email}:${code}`)
      .digest('hex')
  }

  hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto
      .pbkdf2Sync(password, salt, 120000, 32, 'sha256')
      .toString('hex')

    return { salt, hash }
  }

  verifyPassword(password, passwordSalt, passwordHash) {
    const nextHash = crypto
      .pbkdf2Sync(password, passwordSalt, 120000, 32, 'sha256')
      .toString('hex')

    const expectedBuffer = Buffer.from(passwordHash || '', 'hex')
    const actualBuffer = Buffer.from(nextHash, 'hex')
    if (expectedBuffer.length !== actualBuffer.length || expectedBuffer.length === 0) {
      return false
    }

    return crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  }

  async sendEmailCode(rawEmail) {
    this.assertEmailEnabled()
    const email = this.validateEmail(rawEmail)
    const account = await this.accountRepository.findByEmail(email)
    if (account) {
      throw new Error('该邮箱已注册')
    }

    const key = this.getVerificationKey(email)
    const now = Date.now()
    const previous = this.verificationCodes.get(key)
    if (previous && now < previous.nextSendAt) {
      const remainSeconds = Math.ceil((previous.nextSendAt - now) / 1000)
      throw new Error(`验证码发送过于频繁，请 ${remainSeconds} 秒后重试`)
    }

    const code = this.generateVerificationCode()
    const codeHash = this.hashVerificationCode(email, code)
    const ttlMinutes = Math.max(1, Math.ceil(this.verificationCodeTtlMs / 60000))
    const entry = {
      codeHash,
      expiresAt: now + this.verificationCodeTtlMs,
      nextSendAt: now + this.sendCooldownMs,
      attempts: 0,
    }
    this.verificationCodes.set(key, entry)

    return this.emailSender.sendVerificationCode({
      email,
      code,
      purpose: 'register',
      ttlMinutes,
    }).then(({ delivery }) => ({
      success: true,
      delivery,
      expiresInSeconds: Math.ceil(this.verificationCodeTtlMs / 1000),
      nextAllowedInSeconds: Math.ceil(this.sendCooldownMs / 1000),
      debugCode: this.exposeDevCode && delivery === 'console' ? code : undefined,
    })).catch((error) => {
      this.verificationCodes.delete(key)
      throw error
    })
  }

  verifyRegisterCode(email, verificationCode) {
    if (typeof verificationCode !== 'string' || !verificationCode.trim()) {
      throw new Error('验证码不能为空')
    }

    const key = this.getVerificationKey(email)
    const entry = this.verificationCodes.get(key)
    if (!entry) {
      throw new Error('验证码不存在或已失效')
    }

    if (Date.now() > entry.expiresAt) {
      this.verificationCodes.delete(key)
      throw new Error('验证码已过期')
    }

    entry.attempts += 1
    if (entry.attempts > this.maxVerifyAttempts) {
      this.verificationCodes.delete(key)
      throw new Error('验证码尝试次数过多，请重新获取')
    }

    const expectedHash = entry.codeHash
    const actualHash = this.hashVerificationCode(email, verificationCode.trim())
    const expectedBuffer = Buffer.from(expectedHash, 'hex')
    const actualBuffer = Buffer.from(actualHash, 'hex')
    const matched = expectedBuffer.length === actualBuffer.length
      && expectedBuffer.length > 0
      && crypto.timingSafeEqual(expectedBuffer, actualBuffer)
    if (!matched) {
      throw new Error('验证码错误')
    }

    this.verificationCodes.delete(key)
  }

  async register({
    email: rawEmail,
    password,
    verificationCode,
    username,
    inviteCode,
  }, session) {
    this.assertEmailEnabled()
    const email = this.validateEmail(rawEmail)
    this.validatePassword(password)

    if (await this.accountRepository.findByEmail(email)) {
      throw new Error('该邮箱已注册')
    }

    const nextUsername = this.normalizeUsername(username, email)
    const userId = uuidv4()
    const { salt, hash } = this.hashPassword(password)
    const now = Date.now()
    let consumedInviteCode = null

    try {
      if (this.inviteRequired || this.normalizeInviteCode(inviteCode)) {
        consumedInviteCode = await this.consumeInviteCode(inviteCode, {
          email,
          userId,
          now,
        })
      }

      this.verifyRegisterCode(email, verificationCode)

      await this.accountRepository.create({
        email,
        userId,
        username: nextUsername,
        passwordSalt: salt,
        passwordHash: hash,
        verifiedAt: now,
        createdAt: now,
        lastLoginAt: now,
        isMember: false,
        memberExpiresAt: null,
        invitedByUserId: consumedInviteCode?.creatorUserId || null,
      })
    } catch (error) {
      if (consumedInviteCode) {
        try {
          await this.inviteCodeRepository.rollbackConsume(consumedInviteCode.code, { now: Date.now() })
        } catch (rollbackError) {
          // no-op
        }
      }
      throw error
    }

    const sessionToken = this.authService.issueSessionToken(userId)
    const payload = await this.authService.login(nextUsername, session, sessionToken)
    const createdAccount = await this.accountRepository.findByEmail(email)
    return {
      ...payload,
      account: this.toPublicAccount(createdAccount),
    }
  }

  async loginWithPassword({ email: rawEmail, password }, session) {
    this.assertEmailEnabled()
    const email = this.validateEmail(rawEmail)
    if (typeof password !== 'string' || !password) {
      throw new Error('账号或密码错误')
    }

    const account = await this.accountRepository.findByEmail(email)
    if (!account) {
      throw new Error('账号或密码错误')
    }

    const matched = this.verifyPassword(password, account.passwordSalt, account.passwordHash)
    if (!matched) {
      throw new Error('账号或密码错误')
    }

    await this.accountRepository.updateByEmail(email, {
      lastLoginAt: Date.now(),
    })

    const sessionToken = this.authService.issueSessionToken(account.userId)
    const payload = await this.authService.login(account.username, session, sessionToken)
    return {
      ...payload,
      account: this.toPublicAccount(account),
    }
  }
}

module.exports = { AccountAuthService }

const crypto = require('node:crypto')
const { v4: uuidv4 } = require('uuid')
const { getPublicGameState } = require('../domain/gameEngine')
const { serializeRoom } = require('../domain/roomView')

const MAX_USERNAME_LENGTH = 24
const MAX_USER_ID_LENGTH = 64
const DEFAULT_MAX_USER_PROFILES = 5000
const DEFAULT_SESSION_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_SESSION_TOKEN_SECRET = 'daieryou-dev-session-secret'

class AuthService {
  constructor({
    sessionRepository,
    roomService,
    roomRepository,
    lobbyBroadcaster,
    disconnectGraceMs = 15000,
    maxUserProfiles = DEFAULT_MAX_USER_PROFILES,
    sessionTokenSecret = DEFAULT_SESSION_TOKEN_SECRET,
    sessionTokenTtlMs = DEFAULT_SESSION_TOKEN_TTL_MS,
  }) {
    this.sessionRepository = sessionRepository
    this.roomService = roomService
    this.roomRepository = roomRepository
    this.lobbyBroadcaster = lobbyBroadcaster
    this.disconnectGraceMs = disconnectGraceMs
    this.maxUserProfiles = Number.isInteger(maxUserProfiles) && maxUserProfiles > 0
      ? maxUserProfiles
      : DEFAULT_MAX_USER_PROFILES
    this.sessionTokenSecret = typeof sessionTokenSecret === 'string' && sessionTokenSecret.trim()
      ? sessionTokenSecret.trim()
      : DEFAULT_SESSION_TOKEN_SECRET
    this.sessionTokenTtlMs = Number.isInteger(sessionTokenTtlMs) && sessionTokenTtlMs > 0
      ? sessionTokenTtlMs
      : DEFAULT_SESSION_TOKEN_TTL_MS
    this.disconnectTimers = new Map()
    this.userProfiles = new Map()
  }

  clearDisconnectTimer(userId) {
    const timer = this.disconnectTimers.get(userId)
    if (!timer) {
      return
    }

    clearTimeout(timer)
    this.disconnectTimers.delete(userId)
  }

  rememberUserProfile(user) {
    if (!user?.id) {
      return
    }

    const profile = {
      id: user.id,
      username: user.username,
      score: user.score,
      loginTime: user.loginTime || Date.now(),
      lastSeenAt: Date.now(),
    }

    if (this.userProfiles.has(profile.id)) {
      this.userProfiles.delete(profile.id)
    }
    this.userProfiles.set(profile.id, profile)

    while (this.userProfiles.size > this.maxUserProfiles) {
      const oldestUserId = this.userProfiles.keys().next().value
      this.userProfiles.delete(oldestUserId)
    }
  }

  getBaseUser(userId, username) {
    const room = this.roomRepository.findByUserId(userId)
    const roomPlayer = room?.players.find((player) => player.id === userId)
    const cachedUser = this.userProfiles.get(userId)

    if (roomPlayer) {
      return {
        ...roomPlayer,
        username,
        online: true,
      }
    }

    return {
      id: userId,
      username,
      score: cachedUser?.score ?? 1000,
      loginTime: cachedUser?.loginTime ?? Date.now(),
      online: true,
    }
  }

  issueSessionToken(userId) {
    const now = Date.now()
    const payload = {
      uid: userId,
      iat: now,
      exp: now + this.sessionTokenTtlMs,
    }
    const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = crypto
      .createHmac('sha256', this.sessionTokenSecret)
      .update(payloadBase64)
      .digest('base64url')

    return `${payloadBase64}.${signature}`
  }

  verifySessionToken(sessionToken) {
    if (typeof sessionToken !== 'string' || !sessionToken.trim()) {
      return null
    }

    const normalizedToken = sessionToken.trim()
    const tokenParts = normalizedToken.split('.')
    const [payloadBase64, signature] = tokenParts
    if (!payloadBase64 || !signature || tokenParts.length !== 2) {
      return null
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.sessionTokenSecret)
      .update(payloadBase64)
      .digest('base64url')

    const expectedBuffer = Buffer.from(expectedSignature)
    const signatureBuffer = Buffer.from(signature)
    if (
      signatureBuffer.length !== expectedBuffer.length
      || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return null
    }

    let payload = null
    try {
      payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf8'))
    } catch (error) {
      return null
    }

    const userId = typeof payload?.uid === 'string' ? payload.uid.trim() : ''
    const expiresAt = Number(payload?.exp)
    if (!userId || userId.length > MAX_USER_ID_LENGTH) {
      return null
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return null
    }

    return userId
  }

  resolveUserIdFromSession(sessionToken) {
    if (typeof sessionToken !== 'string' || !sessionToken.trim()) {
      return uuidv4()
    }

    const userId = this.verifySessionToken(sessionToken)
    if (!userId) {
      throw new Error('会话已失效，请重新登录')
    }

    return userId
  }

  async login(username, session, sessionToken) {
    if (!username || !username.trim()) {
      throw new Error('用户名不能为空')
    }
    if (username.trim().length > MAX_USERNAME_LENGTH) {
      throw new Error(`用户名不能超过${MAX_USERNAME_LENGTH}个字符`)
    }

    const normalizedUsername = username.trim()
    const userId = this.resolveUserIdFromSession(sessionToken)

    this.clearDisconnectTimer(userId)

    const room = await this.roomService.setUserOnline({ id: userId, username: normalizedUsername })
    const user = this.getBaseUser(userId, normalizedUsername)
    const nextSessionToken = this.issueSessionToken(user.id)

    this.sessionRepository.bindUser(session, user.id)
    session.set('user', user)
    session.push('user', () => {})
    this.rememberUserProfile(user)

    return {
      user,
      room: serializeRoom(room),
      gameState: room?.gameState ? getPublicGameState(room.gameState, user.id) : null,
      finalScores: room?.finalScores || null,
      rooms: this.lobbyBroadcaster.buildRoomList(),
      resumed: Boolean(room),
      sessionToken: nextSessionToken,
    }
  }

  async disconnect(session) {
    const user = session.get('user')
    if (!user || session.superseded) {
      return null
    }

    this.rememberUserProfile(user)
    await this.roomService.setUserOffline(user.id, this.disconnectGraceMs)
    this.clearDisconnectTimer(user.id)

    const timer = setTimeout(() => {
      this.disconnectTimers.delete(user.id)
      this.roomService.cleanupUserFromRooms(user.id, {
        reason: `${user.username} 断线超时，已离开房间`,
      }).catch(() => {})
    }, this.disconnectGraceMs)
    if (typeof timer.unref === 'function') {
      timer.unref()
    }

    this.disconnectTimers.set(user.id, timer)
    return user
  }
}

module.exports = { AuthService }

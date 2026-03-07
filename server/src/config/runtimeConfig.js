const runtimeConfig = require('../../config/runtime-config.json')

function parsePositiveNumber(value, fallbackValue) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue
  }

  return parsed
}

function parseBoolean(value, fallbackValue) {
  if (value === undefined || value === null || value === '') {
    return fallbackValue
  }

  if (value === '1' || value === 'true' || value === 'TRUE') {
    return true
  }

  if (value === '0' || value === 'false' || value === 'FALSE') {
    return false
  }

  return fallbackValue
}

function parseNonEmptyString(value, fallbackValue) {
  if (typeof value !== 'string') {
    return fallbackValue
  }

  const trimmed = value.trim()
  return trimmed || fallbackValue
}

function parseStringList(value, fallbackValue = []) {
  if (typeof value !== 'string') {
    return fallbackValue
  }

  const entries = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return entries.length > 0 ? entries : fallbackValue
}

function loadRuntimeConfig(env = process.env) {
  const network = runtimeConfig.network || {}
  const database = runtimeConfig.database || {}
  const session = runtimeConfig.session || {}
  const roomLifecycle = runtimeConfig.roomLifecycle || {}
  const battleRecordLifecycle = runtimeConfig.battleRecordLifecycle || {}
  const game = runtimeConfig.game || {}
  const roomRepository = runtimeConfig.roomRepository || {}
  const roomMirror = runtimeConfig.roomMirror || {}
  const emailAuth = runtimeConfig.emailAuth || {}

  return {
    wsPort: parsePositiveNumber(env.DAIERYOU_WS_PORT, network.wsPort || 3014),
    maxWsPayloadBytes: parsePositiveNumber(
      env.DAIERYOU_WS_MAX_PAYLOAD_BYTES,
      network.maxWsPayloadBytes || 65536,
    ),
    requestRateWindowMs: parsePositiveNumber(
      env.DAIERYOU_REQUEST_RATE_WINDOW_MS,
      network.requestRateWindowMs || 1000,
    ),
    requestRateMaxRequests: parsePositiveNumber(
      env.DAIERYOU_REQUEST_RATE_MAX_REQUESTS,
      network.requestRateMaxRequests || 80,
    ),
    requestDedupTtlMs: parsePositiveNumber(
      env.DAIERYOU_REQUEST_DEDUP_TTL_MS,
      network.requestDedupTtlMs || 3000,
    ),
    requestDedupMaxEntries: parsePositiveNumber(
      env.DAIERYOU_REQUEST_DEDUP_MAX_ENTRIES,
      network.requestDedupMaxEntries || 20000,
    ),
    mongoUri: env.DAIERYOU_MONGO_URI || database.mongoUri || 'mongodb://localhost:27017/daieryou',
    skipMongo: parseBoolean(env.DAIERYOU_SKIP_MONGO, database.skipMongo ?? false),
    disconnectGraceMs: parsePositiveNumber(
      env.DAIERYOU_DISCONNECT_GRACE_MS,
      session.disconnectGraceMs || 15000,
    ),
    maxUserProfiles: parsePositiveNumber(
      env.DAIERYOU_MAX_USER_PROFILES,
      session.maxUserProfiles || 5000,
    ),
    sessionTokenSecret: parseNonEmptyString(
      env.DAIERYOU_SESSION_TOKEN_SECRET,
      session.sessionTokenSecret || 'daieryou-dev-session-secret',
    ),
    sessionTokenTtlMs: parsePositiveNumber(
      env.DAIERYOU_SESSION_TOKEN_TTL_MS,
      session.sessionTokenTtlMs || 30 * 24 * 60 * 60 * 1000,
    ),
    roomLifecycle: {
      sweepIntervalMs: parsePositiveNumber(
        env.DAIERYOU_ROOM_SWEEP_INTERVAL_MS,
        roomLifecycle.sweepIntervalMs || 30000,
      ),
      finishedRoomTtlMs: parsePositiveNumber(
        env.DAIERYOU_FINISHED_ROOM_TTL_MS,
        roomLifecycle.finishedRoomTtlMs || 5 * 60 * 1000,
      ),
      offlineWaitingRoomTtlMs: parsePositiveNumber(
        env.DAIERYOU_OFFLINE_WAITING_ROOM_TTL_MS,
        roomLifecycle.offlineWaitingRoomTtlMs || 2 * 60 * 1000,
      ),
    },
    battleRecordLifecycle: {
      enabled: parseBoolean(
        env.DAIERYOU_BATTLE_RECORD_CLEANUP_ENABLED,
        battleRecordLifecycle.enabled ?? false,
      ),
      sweepIntervalMs: parsePositiveNumber(
        env.DAIERYOU_BATTLE_RECORD_CLEANUP_INTERVAL_MS,
        battleRecordLifecycle.sweepIntervalMs || 60 * 60 * 1000,
      ),
      retentionMs: parsePositiveNumber(
        env.DAIERYOU_BATTLE_RECORD_RETENTION_MS,
        battleRecordLifecycle.retentionMs || 90 * 24 * 60 * 60 * 1000,
      ),
      cleanupBatchSize: parsePositiveNumber(
        env.DAIERYOU_BATTLE_RECORD_CLEANUP_BATCH_SIZE,
        battleRecordLifecycle.cleanupBatchSize || 500,
      ),
      maxBatchesPerSweep: parsePositiveNumber(
        env.DAIERYOU_BATTLE_RECORD_CLEANUP_MAX_BATCHES,
        battleRecordLifecycle.maxBatchesPerSweep || 3,
      ),
      archiveBeforeCleanup: parseBoolean(
        env.DAIERYOU_BATTLE_RECORD_ARCHIVE_BEFORE_CLEANUP,
        battleRecordLifecycle.archiveBeforeCleanup ?? true,
      ),
    },
    game: {
      roundSelectionTimeoutMs: parsePositiveNumber(
        env.DAIERYOU_ROUND_SELECTION_TIMEOUT_MS,
        game.roundSelectionTimeoutMs || 30000,
      ),
    },
    roomRepository: {
      maxInMemoryRooms: parsePositiveNumber(
        env.DAIERYOU_MAX_IN_MEMORY_ROOMS,
        roomRepository.maxInMemoryRooms || 5000,
      ),
    },
    roomMirror: {
      redisUri: parseNonEmptyString(env.DAIERYOU_REDIS_URI, roomMirror.redisUri || ''),
      keyPrefix: parseNonEmptyString(
        env.DAIERYOU_ROOM_MIRROR_KEY_PREFIX,
        roomMirror.keyPrefix || 'daieryou:room-mirror',
      ),
      snapshotTtlMs: parsePositiveNumber(
        env.DAIERYOU_ROOM_MIRROR_SNAPSHOT_TTL_MS,
        roomMirror.snapshotTtlMs || 24 * 60 * 60 * 1000,
      ),
      connectTimeoutMs: parsePositiveNumber(
        env.DAIERYOU_ROOM_MIRROR_CONNECT_TIMEOUT_MS,
        roomMirror.connectTimeoutMs || 3000,
      ),
      syncIntervalMs: parsePositiveNumber(
        env.DAIERYOU_ROOM_MIRROR_SYNC_INTERVAL_MS,
        roomMirror.syncIntervalMs || 5000,
      ),
      preferMirrorReads: parseBoolean(
        env.DAIERYOU_ROOM_MIRROR_PREFER_READS,
        roomMirror.preferMirrorReads ?? false,
      ),
      primaryMirrorWrites: parseBoolean(
        env.DAIERYOU_ROOM_MIRROR_PRIMARY_WRITES,
        roomMirror.primaryMirrorWrites ?? false,
      ),
      retryIntervalMs: parsePositiveNumber(
        env.DAIERYOU_ROOM_MIRROR_RETRY_INTERVAL_MS,
        roomMirror.retryIntervalMs || 2000,
      ),
    },
    emailAuth: {
      enabled: parseBoolean(
        env.DAIERYOU_AUTH_EMAIL_ENABLED,
        emailAuth.enabled ?? true,
      ),
      inviteRequired: parseBoolean(
        env.DAIERYOU_AUTH_INVITE_REQUIRED,
        emailAuth.inviteRequired ?? false,
      ),
      inviteCodeTtlMs: parsePositiveNumber(
        env.DAIERYOU_AUTH_INVITE_CODE_TTL_MS,
        emailAuth.inviteCodeTtlMs || 7 * 24 * 60 * 60 * 1000,
      ),
      inviteCodeLength: parsePositiveNumber(
        env.DAIERYOU_AUTH_INVITE_CODE_LENGTH,
        emailAuth.inviteCodeLength || 8,
      ),
      memberDefaultDays: parsePositiveNumber(
        env.DAIERYOU_AUTH_MEMBER_DEFAULT_DAYS,
        emailAuth.memberDefaultDays || 30,
      ),
      adminEmails: parseStringList(
        env.DAIERYOU_AUTH_ADMIN_EMAILS,
        parseStringList(emailAuth.adminEmails, []),
      ),
      adminInviteListLimit: parsePositiveNumber(
        env.DAIERYOU_AUTH_ADMIN_INVITE_LIST_LIMIT,
        emailAuth.adminInviteListLimit || 50,
      ),
      adminAuditListLimit: parsePositiveNumber(
        env.DAIERYOU_AUTH_ADMIN_AUDIT_LIST_LIMIT,
        emailAuth.adminAuditListLimit || 50,
      ),
      verificationCodeTtlMs: parsePositiveNumber(
        env.DAIERYOU_EMAIL_VERIFY_CODE_TTL_MS,
        emailAuth.verificationCodeTtlMs || 10 * 60 * 1000,
      ),
      sendCooldownMs: parsePositiveNumber(
        env.DAIERYOU_EMAIL_SEND_COOLDOWN_MS,
        emailAuth.sendCooldownMs || 60 * 1000,
      ),
      maxVerifyAttempts: parsePositiveNumber(
        env.DAIERYOU_EMAIL_MAX_VERIFY_ATTEMPTS,
        emailAuth.maxVerifyAttempts || 5,
      ),
      transport: parseNonEmptyString(
        env.DAIERYOU_EMAIL_TRANSPORT,
        emailAuth.transport || 'console',
      ).toLowerCase(),
      webhookUrl: parseNonEmptyString(
        env.DAIERYOU_EMAIL_WEBHOOK_URL,
        emailAuth.webhookUrl || '',
      ),
      fromAddress: parseNonEmptyString(
        env.DAIERYOU_EMAIL_FROM,
        emailAuth.fromAddress || '',
      ),
      resendApiKey: parseNonEmptyString(
        env.DAIERYOU_RESEND_API_KEY,
        emailAuth.resendApiKey || '',
      ),
      exposeDevCode: parseBoolean(
        env.DAIERYOU_EMAIL_EXPOSE_DEV_CODE,
        emailAuth.exposeDevCode ?? false,
      ),
    },
  }
}

module.exports = { loadRuntimeConfig }

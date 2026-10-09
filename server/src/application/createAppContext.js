const { SessionRepository } = require('../infrastructure/sessionRepository')
const { RoomRepository } = require('../infrastructure/roomRepository')
const { EmailSender } = require('../infrastructure/emailSender')
const { RoomBroadcaster } = require('../infrastructure/roomBroadcaster')
const { LobbyBroadcaster } = require('../infrastructure/lobbyBroadcaster')
const { RoomService } = require('./roomService')
const { AuthService } = require('./authService')
const { AccountAuthService } = require('./accountAuthService')
const { BattleRecordService } = require('./battleRecordService')
const { BattleRecordLifecycleService } = require('./battleRecordLifecycleService')
const { BotDecisionService } = require('./bot/botDecisionService')
const { EmoteService } = require('./emoteService')
const { GameService } = require('./gameService')
const { RoomLifecycleService } = require('./roomLifecycleService')

/**
 * 组装所有服务。不依赖任何特定数据库驱动或运行环境：
 * Node 版（app.js）与 Cloudflare 版（cloudflare/worker.mjs）各自传入存储实现。
 */
function createAppContext({
  runtimeConfig,
  accountRepository,
  inviteCodeRepository,
  adminAuditRepository,
  battleRecordRepository,
  roomMirror = null,
  pgDatabase = null,
}) {
  const sessionRepository = new SessionRepository()
  const emailSender = new EmailSender({
    transport: runtimeConfig.emailAuth.transport,
    webhookUrl: runtimeConfig.emailAuth.webhookUrl,
    fromAddress: runtimeConfig.emailAuth.fromAddress,
    resendApiKey: runtimeConfig.emailAuth.resendApiKey,
  })
  const roomRepository = new RoomRepository({
    roomMirror,
    maxInMemoryRooms: runtimeConfig.roomRepository.maxInMemoryRooms,
    primaryMirrorWrites: runtimeConfig.roomMirror.primaryMirrorWrites,
  })
  const botDecisionService = new BotDecisionService({
    maxSimulations: runtimeConfig.bot.maxSimulations,
    decisionTimeoutMs: runtimeConfig.bot.decisionTimeoutMs,
    llmConfig: runtimeConfig.bot.llm,
  })
  const broadcaster = new RoomBroadcaster(sessionRepository)
  const lobbyBroadcaster = new LobbyBroadcaster({ sessionRepository, roomRepository })
  const roomService = new RoomService({
    roomRepository,
    broadcaster,
    lobbyBroadcaster,
    botConfig: runtimeConfig.bot,
    defaultRoundSelectionTimeoutMs: runtimeConfig.game.roundSelectionTimeoutMs,
  })
  const battleRecordService = new BattleRecordService({
    battleRecordRepository,
  })
  const battleRecordLifecycleService = new BattleRecordLifecycleService({
    battleRecordRepository,
    ...runtimeConfig.battleRecordLifecycle,
  })
  const roomLifecycleService = new RoomLifecycleService({
    roomRepository,
    lobbyBroadcaster,
    ...runtimeConfig.roomLifecycle,
  })

  const context = {
    pgDatabase,
    sessionRepository,
    accountRepository,
    inviteCodeRepository,
    adminAuditRepository,
    battleRecordRepository,
    roomRepository,
    roomMirror,
    emailSender,
    broadcaster,
    lobbyBroadcaster,
    roomLifecycleService,
    battleRecordLifecycleService,
    roomService,
    botDecisionService,
    battleRecordService,
    authService: null,
    accountAuthService: null,
    gameService: null,
    runtimeConfig,
  }

  context.authService = new AuthService({
    accountRepository,
    sessionRepository,
    roomService,
    roomRepository,
    lobbyBroadcaster,
    disconnectGraceMs: runtimeConfig.disconnectGraceMs,
    maxUserProfiles: runtimeConfig.maxUserProfiles,
    sessionTokenSecret: runtimeConfig.sessionTokenSecret,
    sessionTokenTtlMs: runtimeConfig.sessionTokenTtlMs,
  })
  context.accountAuthService = new AccountAuthService({
    accountRepository,
    inviteCodeRepository,
    adminAuditRepository,
    authService: context.authService,
    emailSender,
    emailEnabled: runtimeConfig.emailAuth.enabled,
    inviteRequired: runtimeConfig.emailAuth.inviteRequired,
    inviteCodeTtlMs: runtimeConfig.emailAuth.inviteCodeTtlMs,
    inviteCodeLength: runtimeConfig.emailAuth.inviteCodeLength,
    memberDefaultDays: runtimeConfig.emailAuth.memberDefaultDays,
    memberSelfServicePurchaseEnabled: runtimeConfig.emailAuth.memberSelfServicePurchaseEnabled,
    passwordHashIterations: runtimeConfig.emailAuth.passwordHashIterations,
    adminEmails: runtimeConfig.emailAuth.adminEmails,
    adminInviteListLimit: runtimeConfig.emailAuth.adminInviteListLimit,
    adminAuditListLimit: runtimeConfig.emailAuth.adminAuditListLimit,
    verificationCodeTtlMs: runtimeConfig.emailAuth.verificationCodeTtlMs,
    sendCooldownMs: runtimeConfig.emailAuth.sendCooldownMs,
    maxVerifyAttempts: runtimeConfig.emailAuth.maxVerifyAttempts,
    exposeDevCode: runtimeConfig.emailAuth.exposeDevCode,
    codeHashSecret: runtimeConfig.sessionTokenSecret,
  })
  context.gameService = new GameService({
    roomRepository,
    broadcaster,
    lobbyBroadcaster,
    battleRecordService,
    botDecisionService,
    botDecisionTimeoutMs: runtimeConfig.bot.decisionTimeoutMs,
    roundSelectionTimeoutMs: runtimeConfig.game.roundSelectionTimeoutMs,
  })

  context.emoteService = new EmoteService({
    roomRepository,
    broadcaster,
  })

  return context
}

module.exports = { createAppContext }

const { SessionRepository } = require('../infrastructure/sessionRepository')
const { RoomRepository } = require('../infrastructure/roomRepository')
const { RedisRoomMirror } = require('../infrastructure/redisRoomMirror')
const { AccountRepository } = require('../infrastructure/accountRepository')
const { InviteCodeRepository } = require('../infrastructure/inviteCodeRepository')
const { AdminAuditRepository } = require('../infrastructure/adminAuditRepository')
const { BattleRecordRepository } = require('../infrastructure/battleRecordRepository')
const { EmailSender } = require('../infrastructure/emailSender')
const { RoomBroadcaster } = require('../infrastructure/roomBroadcaster')
const { LobbyBroadcaster } = require('../infrastructure/lobbyBroadcaster')
const { RoomService } = require('./roomService')
const { AuthService } = require('./authService')
const { AccountAuthService } = require('./accountAuthService')
const { BattleRecordService } = require('./battleRecordService')
const { BattleRecordLifecycleService } = require('./battleRecordLifecycleService')
const { BotDecisionService } = require('./bot/botDecisionService')
const { GameService } = require('./gameService')
const { RoomLifecycleService } = require('./roomLifecycleService')
const { loadRuntimeConfig } = require('../config/runtimeConfig')

const runtimeConfig = loadRuntimeConfig()

const sessionRepository = new SessionRepository()
const accountRepository = new AccountRepository()
const inviteCodeRepository = new InviteCodeRepository()
const adminAuditRepository = new AdminAuditRepository()
const battleRecordRepository = new BattleRecordRepository()
const roomMirror = new RedisRoomMirror({
  ...runtimeConfig.roomMirror,
})
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

const appContext = {
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

appContext.authService = new AuthService({
  sessionRepository,
  roomService,
  roomRepository,
  lobbyBroadcaster,
  disconnectGraceMs: runtimeConfig.disconnectGraceMs,
  maxUserProfiles: runtimeConfig.maxUserProfiles,
  sessionTokenSecret: runtimeConfig.sessionTokenSecret,
  sessionTokenTtlMs: runtimeConfig.sessionTokenTtlMs,
})
appContext.accountAuthService = new AccountAuthService({
  accountRepository,
  inviteCodeRepository,
  adminAuditRepository,
  authService: appContext.authService,
  emailSender,
  emailEnabled: runtimeConfig.emailAuth.enabled,
  inviteRequired: runtimeConfig.emailAuth.inviteRequired,
  inviteCodeTtlMs: runtimeConfig.emailAuth.inviteCodeTtlMs,
  inviteCodeLength: runtimeConfig.emailAuth.inviteCodeLength,
  memberDefaultDays: runtimeConfig.emailAuth.memberDefaultDays,
  adminEmails: runtimeConfig.emailAuth.adminEmails,
  adminInviteListLimit: runtimeConfig.emailAuth.adminInviteListLimit,
  adminAuditListLimit: runtimeConfig.emailAuth.adminAuditListLimit,
  verificationCodeTtlMs: runtimeConfig.emailAuth.verificationCodeTtlMs,
  sendCooldownMs: runtimeConfig.emailAuth.sendCooldownMs,
  maxVerifyAttempts: runtimeConfig.emailAuth.maxVerifyAttempts,
  exposeDevCode: runtimeConfig.emailAuth.exposeDevCode,
  codeHashSecret: runtimeConfig.sessionTokenSecret,
})
appContext.gameService = new GameService({
  roomRepository,
  broadcaster,
  lobbyBroadcaster,
  battleRecordService,
  botDecisionService,
  botDecisionTimeoutMs: runtimeConfig.bot.decisionTimeoutMs,
  roundSelectionTimeoutMs: runtimeConfig.game.roundSelectionTimeoutMs,
})

module.exports = { appContext }

const { SessionRepository } = require('../infrastructure/sessionRepository')
const { RoomRepository } = require('../infrastructure/roomRepository')
const { RedisRoomMirror } = require('../infrastructure/redisRoomMirror')
const { AccountRepository } = require('../infrastructure/accountRepository')
const { InviteCodeRepository } = require('../infrastructure/inviteCodeRepository')
const { EmailSender } = require('../infrastructure/emailSender')
const { RoomBroadcaster } = require('../infrastructure/roomBroadcaster')
const { LobbyBroadcaster } = require('../infrastructure/lobbyBroadcaster')
const { RoomService } = require('./roomService')
const { AuthService } = require('./authService')
const { AccountAuthService } = require('./accountAuthService')
const { GameService } = require('./gameService')
const { RoomLifecycleService } = require('./roomLifecycleService')
const { loadRuntimeConfig } = require('../config/runtimeConfig')

const runtimeConfig = loadRuntimeConfig()

const sessionRepository = new SessionRepository()
const accountRepository = new AccountRepository()
const inviteCodeRepository = new InviteCodeRepository()
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
})
const broadcaster = new RoomBroadcaster(sessionRepository)
const lobbyBroadcaster = new LobbyBroadcaster({ sessionRepository, roomRepository })
const roomService = new RoomService({ roomRepository, broadcaster, lobbyBroadcaster })
const roomLifecycleService = new RoomLifecycleService({
  roomRepository,
  lobbyBroadcaster,
  ...runtimeConfig.roomLifecycle,
})

const appContext = {
  sessionRepository,
  accountRepository,
  inviteCodeRepository,
  roomRepository,
  roomMirror,
  emailSender,
  broadcaster,
  lobbyBroadcaster,
  roomLifecycleService,
  roomService,
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
  authService: appContext.authService,
  emailSender,
  emailEnabled: runtimeConfig.emailAuth.enabled,
  inviteRequired: runtimeConfig.emailAuth.inviteRequired,
  inviteCodeTtlMs: runtimeConfig.emailAuth.inviteCodeTtlMs,
  inviteCodeLength: runtimeConfig.emailAuth.inviteCodeLength,
  memberDefaultDays: runtimeConfig.emailAuth.memberDefaultDays,
  adminEmails: runtimeConfig.emailAuth.adminEmails,
  adminInviteListLimit: runtimeConfig.emailAuth.adminInviteListLimit,
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
  roundSelectionTimeoutMs: runtimeConfig.game.roundSelectionTimeoutMs,
})

module.exports = { appContext }

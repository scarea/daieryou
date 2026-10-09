// Node 运行时的 appContext：根据配置选择 MongoDB 或 Postgres 存储，并启用 Redis 房间镜像。
const { RedisRoomMirror } = require('../infrastructure/redisRoomMirror')
const { AccountRepository } = require('../infrastructure/accountRepository')
const { InviteCodeRepository } = require('../infrastructure/inviteCodeRepository')
const { AdminAuditRepository } = require('../infrastructure/adminAuditRepository')
const { BattleRecordRepository } = require('../infrastructure/battleRecordRepository')
const { PgDatabase } = require('../infrastructure/postgres/pgDatabase')
const {
  PgAccountRepository,
  PgInviteCodeRepository,
  PgAdminAuditRepository,
  PgBattleRecordRepository,
} = require('../infrastructure/postgres/pgRepositories')
const { loadRuntimeConfig } = require('../config/runtimeConfig')
const { createAppContext } = require('./createAppContext')
const { appContext, setAppContext } = require('./appContextHolder')

const runtimeConfig = loadRuntimeConfig()

// 存储选择：配置了 DAIERYOU_DATABASE_URL 用 Postgres（Supabase），否则用 MongoDB
const pgDatabase = runtimeConfig.databaseUrl
  ? new PgDatabase({ connectionString: runtimeConfig.databaseUrl, ssl: runtimeConfig.databaseSsl })
  : null

setAppContext(createAppContext({
  runtimeConfig,
  pgDatabase,
  accountRepository: pgDatabase ? new PgAccountRepository({ database: pgDatabase }) : new AccountRepository(),
  inviteCodeRepository: pgDatabase ? new PgInviteCodeRepository({ database: pgDatabase }) : new InviteCodeRepository(),
  adminAuditRepository: pgDatabase ? new PgAdminAuditRepository({ database: pgDatabase }) : new AdminAuditRepository(),
  battleRecordRepository: pgDatabase ? new PgBattleRecordRepository({ database: pgDatabase }) : new BattleRecordRepository(),
  roomMirror: new RedisRoomMirror({ ...runtimeConfig.roomMirror }),
}))

module.exports = { appContext }

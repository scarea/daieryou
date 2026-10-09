const test = require('node:test')
const assert = require('node:assert/strict')
const { PgDatabase } = require('../src/infrastructure/postgres/pgDatabase')
const {
  PgAccountRepository,
  PgInviteCodeRepository,
  PgAdminAuditRepository,
  PgBattleRecordRepository,
} = require('../src/infrastructure/postgres/pgRepositories')

// 需要一个真实的 Postgres：DAIERYOU_TEST_DATABASE_URL=postgres://... npm test
const connectionString = process.env.DAIERYOU_TEST_DATABASE_URL
const skip = connectionString ? false : '未设置 DAIERYOU_TEST_DATABASE_URL，跳过 Postgres 集成测试'

let database
test.before(async () => {
  if (skip) {
    return
  }
  database = new PgDatabase({ connectionString, ssl: process.env.DAIERYOU_TEST_DATABASE_SSL || 'disable' })
  await database.connect({ migrate: true })
  // schema 可重复执行
  await database.connect({ migrate: true })
  await database.query('truncate accounts, invite_codes, admin_audit_logs, battle_records, battle_record_archives, service_heartbeats')
})

test.after(async () => {
  await database?.close()
})

test('pg account repository should create, find and update accounts', { skip }, async () => {
  const repository = new PgAccountRepository({ database })
  const created = await repository.create({
    email: ' Tester@Example.com ',
    userId: 'user-1',
    username: 'Tester',
    passwordSalt: 'salt',
    passwordHash: 'hash',
    verifiedAt: 1000,
  })
  assert.equal(created.email, 'tester@example.com')
  assert.equal(created.isMember, false)
  assert.equal(typeof created.createdAt, 'number')

  await assert.rejects(() => repository.create({ ...created, userId: 'user-2' }), /该邮箱已注册/)
  assert.equal((await repository.findByUserId('user-1')).username, 'Tester')

  const updated = await repository.updateByEmail('TESTER@example.com', { isMember: true, memberExpiresAt: 99999 })
  assert.equal(updated.isMember, true)
  assert.equal(updated.memberExpiresAt, 99999)
  assert.equal(await repository.findByEmail('nobody@example.com'), null)
})

test('pg invite code repository should consume atomically and roll back', { skip }, async () => {
  const repository = new PgInviteCodeRepository({ database })
  const now = Date.now()
  await repository.createInviteCode({ code: 'abcd1234', creatorUserId: 'user-1', expiresAt: now + 60000, createdAt: now })
  await assert.rejects(
    () => repository.createInviteCode({ code: 'ABCD1234', creatorUserId: 'user-1', expiresAt: now + 60000, createdAt: now }),
    (error) => error.code === 'INVITE_CODE_DUPLICATED',
  )

  // 并发消费同一个单次邀请码：只能成功一次
  const results = await Promise.all([
    repository.consumeActiveCode('ABCD1234', { userId: 'a', now }),
    repository.consumeActiveCode('ABCD1234', { userId: 'b', now }),
  ])
  assert.equal(results.filter(Boolean).length, 1)

  const rolledBack = await repository.rollbackConsume('ABCD1234', { now })
  assert.equal(rolledBack.status, 'active')
  assert.equal(rolledBack.usedCount, 0)

  const disabled = await repository.disableCode('ABCD1234', { reason: 'test', disabledByUserId: 'admin' })
  assert.equal(disabled.status, 'disabled')
  assert.equal((await repository.listInviteCodes({ status: 'disabled' })).length, 1)
})

test('pg audit repository should store json detail', { skip }, async () => {
  const repository = new PgAdminAuditRepository({ database })
  await repository.createLog({ action: 'membership.grant', actorEmail: 'Admin@X.com', detail: { days: 30 }, createdAt: 1 })
  await repository.createLog({ action: 'invite.disable', createdAt: 2 })
  const logs = await repository.listLogs({ limit: 10 })
  assert.equal(logs[0].action, 'invite.disable')
  assert.deepEqual(logs[1].detail, { days: 30 })
  assert.equal(logs[1].actorEmail, 'admin@x.com')
  assert.equal((await repository.listLogs({ action: 'membership.grant' })).length, 1)
})

test('pg battle record repository should upsert, query, summarize and archive', { skip }, async () => {
  const repository = new PgBattleRecordRepository({ database })
  const base = { userId: 'user-1', roomId: 'room-a', playerCount: 3, username: 'Tester', roundScores: [1, -2, 3, 4, 5] }
  await repository.saveRecords([
    { ...base, matchId: 'm1', finishedAt: 1000, rank: 1, totalScore: 11, opponents: [{ playerId: 'p2', username: 'B', totalScore: -5, rank: 2 }] },
    { ...base, matchId: 'm2', finishedAt: 2000, rank: 3, totalScore: -4 },
  ])
  // 再次写入同一局应覆盖而不是重复
  await repository.saveRecords([{ ...base, matchId: 'm2', finishedAt: 2000, rank: 2, totalScore: -6 }])

  const page = await repository.listByUserId('user-1', { limit: 10 })
  assert.equal(page.total, 2)
  assert.equal(page.records[0].matchId, 'm2')
  assert.equal(page.records[0].rank, 2)
  assert.deepEqual(page.records[1].opponents[0].username, 'B')
  assert.equal((await repository.listByUserId('user-1', { rank: 1 })).total, 1)

  const summary = await repository.getSummaryByUserId('user-1')
  assert.deepEqual(summary, { totalGames: 2, winCount: 1, totalScoreChange: 5, avgScore: 2.5 })

  const cleanup = await repository.archiveAndCleanupExpired({ expireBefore: 1500, batchSize: 10 })
  assert.deepEqual(cleanup, { scanned: 1, archived: 1, deleted: 1, hasMore: false })
  assert.equal((await repository.listByUserId('user-1')).total, 1)
  assert.equal((await repository.auditIndexes()).healthy, true)
})

test('pg database heartbeat should upsert a single row', { skip }, async () => {
  await database.heartbeat('game-server', { n: 1 })
  await database.heartbeat('game-server', { n: 2 })
  const { rows } = await database.query('select * from service_heartbeats')
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].detail, { n: 2 })
})

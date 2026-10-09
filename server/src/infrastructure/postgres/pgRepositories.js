// 与 MongoDB 版本接口完全一致的 Postgres 存储实现（账号、邀请码、审计日志、战绩）。
// 校验/归一化逻辑复用原仓库类，只替换数据读写部分，保证两种存储行为一致。
const { AccountRepository } = require('../accountRepository')
const { InviteCodeRepository } = require('../inviteCodeRepository')
const { AdminAuditRepository } = require('../adminAuditRepository')
const { BattleRecordRepository } = require('../battleRecordRepository')

const UNIQUE_VIOLATION = '23505'

function toNumber(value) {
  if (value === null || value === undefined) {
    return null
  }
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function ensureReady(database, message) {
  if (!database?.isReady()) {
    throw new Error(message)
  }
}

// ---------------- 账号 ----------------

const ACCOUNT_COLUMNS = {
  userId: 'user_id',
  email: 'email',
  username: 'username',
  passwordSalt: 'password_salt',
  passwordHash: 'password_hash',
  verifiedAt: 'verified_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  lastLoginAt: 'last_login_at',
  isMember: 'is_member',
  isAdmin: 'is_admin',
  memberExpiresAt: 'member_expires_at',
  invitedByUserId: 'invited_by_user_id',
}
const ACCOUNT_NUMBER_FIELDS = new Set(['verifiedAt', 'createdAt', 'updatedAt', 'lastLoginAt', 'memberExpiresAt'])

function mapAccountRow(row) {
  if (!row) {
    return null
  }
  const account = {}
  Object.entries(ACCOUNT_COLUMNS).forEach(([field, column]) => {
    account[field] = ACCOUNT_NUMBER_FIELDS.has(field) ? toNumber(row[column]) : row[column]
  })
  return account
}

class PgAccountRepository extends AccountRepository {
  constructor({ database }) {
    super()
    this.database = database
  }

  ensureDatabaseReady() {
    ensureReady(this.database, '账号系统暂不可用，请检查数据库连接')
  }

  async findByEmail(email) {
    this.ensureDatabaseReady()
    const normalizedEmail = this.normalizeEmail(email)
    if (!normalizedEmail) {
      return null
    }
    const { rows } = await this.database.query('select * from accounts where email = $1', [normalizedEmail])
    return mapAccountRow(rows[0])
  }

  async findByUserId(userId) {
    this.ensureDatabaseReady()
    if (typeof userId !== 'string' || !userId.trim()) {
      return null
    }
    const { rows } = await this.database.query('select * from accounts where user_id = $1', [userId.trim()])
    return mapAccountRow(rows[0])
  }

  async create(account) {
    this.ensureDatabaseReady()
    const normalizedEmail = this.normalizeEmail(account?.email)
    if (!normalizedEmail) {
      throw new Error('邮箱不能为空')
    }

    const now = Date.now()
    const next = {
      ...account,
      email: normalizedEmail,
      createdAt: account?.createdAt || now,
      updatedAt: now,
      lastLoginAt: account?.lastLoginAt || null,
      isMember: account?.isMember === true,
      isAdmin: account?.isAdmin === true,
      memberExpiresAt: Number.isFinite(account?.memberExpiresAt) ? account.memberExpiresAt : null,
      invitedByUserId: account?.invitedByUserId || null,
    }
    const fields = Object.keys(ACCOUNT_COLUMNS)
    const values = fields.map((field) => (next[field] === undefined ? null : next[field]))

    try {
      const { rows } = await this.database.query(
        `insert into accounts (${fields.map((field) => ACCOUNT_COLUMNS[field]).join(', ')})
         values (${fields.map((_, index) => `$${index + 1}`).join(', ')})
         returning *`,
        values,
      )
      return mapAccountRow(rows[0])
    } catch (error) {
      if (error?.code === UNIQUE_VIOLATION) {
        throw new Error('该邮箱已注册')
      }
      throw error
    }
  }

  async updateByEmail(email, updates = {}) {
    this.ensureDatabaseReady()
    const normalizedEmail = this.normalizeEmail(email)
    if (!normalizedEmail) {
      return null
    }

    const patch = { ...updates, updatedAt: Date.now() }
    const fields = Object.keys(patch).filter((field) => ACCOUNT_COLUMNS[field] && field !== 'email')
    const assignments = fields.map((field, index) => `${ACCOUNT_COLUMNS[field]} = $${index + 2}`)
    const { rows } = await this.database.query(
      `update accounts set ${assignments.join(', ')} where email = $1 returning *`,
      [normalizedEmail, ...fields.map((field) => (patch[field] === undefined ? null : patch[field]))],
    )
    return mapAccountRow(rows[0])
  }
}

// ---------------- 邀请码 ----------------

function mapInviteCodeRow(row) {
  if (!row) {
    return null
  }
  return {
    code: row.code,
    creatorUserId: row.creator_user_id,
    channel: row.channel,
    campaign: row.campaign,
    remark: row.remark,
    status: row.status,
    expiresAt: toNumber(row.expires_at),
    usedCount: toNumber(row.used_count),
    maxUses: toNumber(row.max_uses),
    usedByUserId: row.used_by_user_id,
    usedByEmail: row.used_by_email,
    usedAt: toNumber(row.used_at),
    disabledByUserId: row.disabled_by_user_id,
    disabledReason: row.disabled_reason,
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
  }
}

class PgInviteCodeRepository extends InviteCodeRepository {
  constructor({ database }) {
    super()
    this.database = database
  }

  ensureDatabaseReady() {
    ensureReady(this.database, '邀请码系统暂不可用，请检查数据库连接')
  }

  async createInviteCode({
    code,
    creatorUserId,
    expiresAt,
    maxUses = 1,
    channel = 'member',
    campaign = '',
    remark = '',
    createdAt = Date.now(),
  }) {
    this.ensureDatabaseReady()

    const normalizedCode = this.normalizeCode(code)
    if (!normalizedCode) {
      throw new Error('邀请码不能为空')
    }
    if (typeof creatorUserId !== 'string' || !creatorUserId.trim()) {
      throw new Error('邀请码创建者不能为空')
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= createdAt) {
      throw new Error('邀请码有效期无效')
    }

    try {
      const { rows } = await this.database.query(
        `insert into invite_codes
          (code, creator_user_id, channel, campaign, remark, status, expires_at, used_count, max_uses, created_at, updated_at)
         values ($1, $2, $3, $4, $5, 'active', $6, 0, $7, $8, $8)
         returning *`,
        [
          normalizedCode,
          creatorUserId.trim(),
          this.normalizeText(channel, 32) || 'member',
          this.normalizeText(campaign, 64),
          this.normalizeText(remark, 120),
          expiresAt,
          Math.max(1, Math.floor(maxUses)),
          createdAt,
        ],
      )
      return mapInviteCodeRow(rows[0])
    } catch (error) {
      if (error?.code === UNIQUE_VIOLATION) {
        const conflictError = new Error('邀请码重复')
        conflictError.code = 'INVITE_CODE_DUPLICATED'
        throw conflictError
      }
      throw error
    }
  }

  async findByCode(code) {
    this.ensureDatabaseReady()
    const normalizedCode = this.normalizeCode(code)
    if (!normalizedCode) {
      return null
    }
    const { rows } = await this.database.query('select * from invite_codes where code = $1', [normalizedCode])
    return mapInviteCodeRow(rows[0])
  }

  // 原子消费：单条 UPDATE 带条件，天然防止并发重复使用
  async consumeActiveCode(code, { userId = null, email = null, now = Date.now() } = {}) {
    this.ensureDatabaseReady()
    const normalizedCode = this.normalizeCode(code)
    if (!normalizedCode) {
      return null
    }
    const { rows } = await this.database.query(
      `update invite_codes set
         status = 'used',
         updated_at = $2,
         used_by_user_id = $3,
         used_by_email = $4,
         used_at = $2,
         used_count = used_count + 1
       where code = $1 and status = 'active' and expires_at > $2 and used_count < max_uses
       returning *`,
      [
        normalizedCode,
        now,
        typeof userId === 'string' && userId.trim() ? userId.trim() : null,
        typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null,
      ],
    )
    return mapInviteCodeRow(rows[0])
  }

  async rollbackConsume(code, { now = Date.now() } = {}) {
    this.ensureDatabaseReady()
    const normalizedCode = this.normalizeCode(code)
    if (!normalizedCode) {
      return null
    }
    const { rows } = await this.database.query(
      `update invite_codes set
         status = 'active',
         updated_at = $2,
         used_by_user_id = null,
         used_by_email = null,
         used_at = null,
         disabled_by_user_id = null,
         disabled_reason = null,
         used_count = used_count - 1
       where code = $1 and status = 'used' and used_count >= 1
       returning *`,
      [normalizedCode, now],
    )
    return mapInviteCodeRow(rows[0])
  }

  async listInviteCodes({ limit = 50, status = null } = {}) {
    this.ensureDatabaseReady()
    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)))
    const normalizedStatus = this.normalizeText(status, 32)
    const { rows } = normalizedStatus
      ? await this.database.query(
        'select * from invite_codes where status = $1 order by created_at desc limit $2',
        [normalizedStatus, safeLimit],
      )
      : await this.database.query('select * from invite_codes order by created_at desc limit $1', [safeLimit])
    return rows.map(mapInviteCodeRow)
  }

  async disableCode(code, { reason = '', disabledByUserId = null, now = Date.now() } = {}) {
    this.ensureDatabaseReady()
    const normalizedCode = this.normalizeCode(code)
    if (!normalizedCode) {
      return null
    }
    const { rows } = await this.database.query(
      `update invite_codes set
         status = 'disabled',
         updated_at = $2,
         disabled_reason = $3,
         disabled_by_user_id = $4
       where code = $1 and status in ('active', 'used', 'expired')
       returning *`,
      [
        normalizedCode,
        now,
        this.normalizeText(reason, 120) || null,
        this.normalizeText(disabledByUserId, 64) || null,
      ],
    )
    return mapInviteCodeRow(rows[0])
  }
}

// ---------------- 审计日志 ----------------

function mapAuditRow(row) {
  if (!row) {
    return null
  }
  return {
    action: row.action,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    targetUserId: row.target_user_id,
    targetEmail: row.target_email,
    source: row.source,
    detail: row.detail || {},
    createdAt: toNumber(row.created_at),
  }
}

class PgAdminAuditRepository extends AdminAuditRepository {
  constructor({ database }) {
    super()
    this.database = database
  }

  ensureDatabaseReady() {
    ensureReady(this.database, '审计日志系统暂不可用，请检查数据库连接')
  }

  async createLog({
    action,
    actorUserId = null,
    actorEmail = null,
    targetUserId = null,
    targetEmail = null,
    source = 'system',
    detail = {},
    createdAt = Date.now(),
  }) {
    this.ensureDatabaseReady()
    const normalizedAction = this.normalizeText(action, 64)
    if (!normalizedAction) {
      throw new Error('审计动作不能为空')
    }
    const { rows } = await this.database.query(
      `insert into admin_audit_logs (action, actor_user_id, actor_email, target_user_id, target_email, source, detail, created_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       returning *`,
      [
        normalizedAction,
        this.normalizeText(actorUserId, 64) || null,
        this.normalizeEmail(actorEmail) || null,
        this.normalizeText(targetUserId, 64) || null,
        this.normalizeEmail(targetEmail) || null,
        this.normalizeText(source, 32) || 'system',
        JSON.stringify(this.normalizeDetail(detail)),
        Number.isFinite(createdAt) ? createdAt : Date.now(),
      ],
    )
    return mapAuditRow(rows[0])
  }

  async listLogs({ limit = 50, action = null } = {}) {
    this.ensureDatabaseReady()
    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)))
    const normalizedAction = this.normalizeText(action, 64)
    const { rows } = normalizedAction
      ? await this.database.query(
        'select * from admin_audit_logs where action = $1 order by created_at desc limit $2',
        [normalizedAction, safeLimit],
      )
      : await this.database.query('select * from admin_audit_logs order by created_at desc limit $1', [safeLimit])
    return rows.map(mapAuditRow)
  }
}

// ---------------- 战绩 ----------------

const BATTLE_COLUMNS = [
  'user_id', 'match_id', 'room_id', 'finished_at', 'player_count', 'rank', 'username',
  'total_score', 'round_scores', 'opponents', 'created_at', 'updated_at',
]

function mapBattleRow(row) {
  if (!row) {
    return null
  }
  return {
    userId: row.user_id,
    matchId: row.match_id,
    roomId: row.room_id,
    finishedAt: toNumber(row.finished_at),
    playerCount: toNumber(row.player_count),
    rank: toNumber(row.rank),
    username: row.username,
    totalScore: toNumber(row.total_score),
    roundScores: Array.isArray(row.round_scores) ? row.round_scores : [],
    opponents: Array.isArray(row.opponents) ? row.opponents : [],
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
  }
}

class PgBattleRecordRepository extends BattleRecordRepository {
  constructor({ database }) {
    super()
    this.database = database
  }

  ensureDatabaseReady() {
    ensureReady(this.database, '战绩系统暂不可用，请检查数据库连接')
  }

  buildWhere(normalizedUserId, options) {
    const conditions = ['user_id = $1']
    const params = [normalizedUserId]
    if (options.roomId) {
      params.push(options.roomId)
      conditions.push(`room_id = $${params.length}`)
    }
    if (options.rank != null) {
      params.push(options.rank)
      conditions.push(`rank = $${params.length}`)
    }
    if (options.startTime != null) {
      params.push(options.startTime)
      conditions.push(`finished_at >= $${params.length}`)
    }
    if (options.endTime != null) {
      params.push(options.endTime)
      conditions.push(`finished_at <= $${params.length}`)
    }
    return { where: conditions.join(' and '), params }
  }

  async saveRecords(records = []) {
    this.ensureDatabaseReady()
    if (!Array.isArray(records) || records.length === 0) {
      return { upserted: 0 }
    }

    const now = Date.now()
    const normalized = records.map((record) => this.normalizeRecord(record, now)).filter(Boolean)
    if (normalized.length === 0) {
      return { upserted: 0 }
    }

    await this.database.transaction(async (client) => {
      for (const record of normalized) {
        await client.query(
          `insert into battle_records (${BATTLE_COLUMNS.join(', ')})
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $11)
           on conflict (user_id, match_id) do update set
             room_id = excluded.room_id,
             finished_at = excluded.finished_at,
             player_count = excluded.player_count,
             rank = excluded.rank,
             username = excluded.username,
             total_score = excluded.total_score,
             round_scores = excluded.round_scores,
             opponents = excluded.opponents,
             updated_at = excluded.updated_at`,
          [
            record.userId,
            record.matchId,
            record.roomId,
            record.finishedAt,
            record.playerCount,
            record.rank,
            record.username,
            record.totalScore,
            JSON.stringify(record.roundScores),
            JSON.stringify(record.opponents),
            now,
          ],
        )
      }
    })
    return { upserted: normalized.length }
  }

  async listByUserId(userId, options = {}) {
    this.ensureDatabaseReady()
    const normalizedUserId = this.normalizeText(userId, 64)
    if (!normalizedUserId) {
      return {
        records: [],
        total: 0,
        page: 1,
        limit: this.normalizePositiveInteger(options?.limit, 20, { min: 1, max: 100 }),
      }
    }

    const queryOptions = this.normalizeQueryOptions(options)
    const { where, params } = this.buildWhere(normalizedUserId, queryOptions)
    const offset = (queryOptions.page - 1) * queryOptions.limit
    const [listResult, countResult] = await Promise.all([
      this.database.query(
        `select * from battle_records where ${where}
         order by finished_at desc, updated_at desc
         limit $${params.length + 1} offset $${params.length + 2}`,
        [...params, queryOptions.limit, offset],
      ),
      this.database.query(`select count(*)::bigint as total from battle_records where ${where}`, params),
    ])

    return {
      records: listResult.rows.map(mapBattleRow),
      total: toNumber(countResult.rows[0]?.total) || 0,
      page: queryOptions.page,
      limit: queryOptions.limit,
    }
  }

  async getSummaryByUserId(userId, options = {}) {
    this.ensureDatabaseReady()
    const normalizedUserId = this.normalizeText(userId, 64)
    if (!normalizedUserId) {
      return this.buildEmptySummary()
    }

    const queryOptions = this.normalizeQueryOptions(options)
    const { where, params } = this.buildWhere(normalizedUserId, queryOptions)
    const { rows } = await this.database.query(
      `select
         count(*)::bigint as total_games,
         count(*) filter (where rank = 1)::bigint as win_count,
         coalesce(sum(total_score), 0) as total_score_change,
         coalesce(avg(total_score), 0) as avg_score
       from battle_records where ${where}`,
      params,
    )
    const summary = rows[0]
    if (!summary || toNumber(summary.total_games) === 0) {
      return this.buildEmptySummary()
    }
    return {
      totalGames: toNumber(summary.total_games) || 0,
      winCount: toNumber(summary.win_count) || 0,
      totalScoreChange: toNumber(summary.total_score_change) || 0,
      avgScore: toNumber(summary.avg_score) || 0,
    }
  }

  async archiveAndCleanupExpired(options = {}) {
    this.ensureDatabaseReady()
    const normalizedOptions = this.normalizeCleanupOptions(options)

    return this.database.transaction(async (client) => {
      const { rows } = await client.query(
        `select * from battle_records where finished_at < $1
         order by finished_at asc, updated_at asc
         limit $2
         for update skip locked`,
        [normalizedOptions.expireBefore, normalizedOptions.batchSize],
      )
      if (rows.length === 0) {
        return { scanned: 0, archived: 0, deleted: 0, hasMore: false }
      }

      if (normalizedOptions.archiveEnabled) {
        const archivedAt = Date.now()
        for (const row of rows) {
          await client.query(
            `insert into battle_record_archives (${BATTLE_COLUMNS.join(', ')}, archived_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13)
             on conflict (user_id, match_id) do update set
               room_id = excluded.room_id,
               finished_at = excluded.finished_at,
               player_count = excluded.player_count,
               rank = excluded.rank,
               username = excluded.username,
               total_score = excluded.total_score,
               round_scores = excluded.round_scores,
               opponents = excluded.opponents,
               updated_at = excluded.updated_at,
               archived_at = excluded.archived_at`,
            [
              row.user_id, row.match_id, row.room_id, row.finished_at, row.player_count, row.rank,
              row.username, row.total_score, JSON.stringify(row.round_scores), JSON.stringify(row.opponents),
              row.created_at, row.updated_at, archivedAt,
            ],
          )
        }
      }

      const deleteResult = await client.query(
        `delete from battle_records where (user_id, match_id) in (
           select * from unnest($1::text[], $2::text[])
         )`,
        [rows.map((row) => row.user_id), rows.map((row) => row.match_id)],
      )

      return {
        scanned: rows.length,
        archived: normalizedOptions.archiveEnabled ? rows.length : 0,
        deleted: deleteResult.rowCount || 0,
        hasMore: rows.length >= normalizedOptions.batchSize,
      }
    })
  }

  // Postgres 的索引由 schema.sql 管理，这里只做存在性检查
  async auditIndexes() {
    this.ensureDatabaseReady()
    const { rows } = await this.database.query(
      `select indexname from pg_indexes where tablename in ('battle_records', 'battle_record_archives')`,
    )
    const names = new Set(rows.map((row) => row.indexname))
    const expected = [
      'battle_records_user_finished_idx',
      'battle_records_user_room_finished_idx',
      'battle_records_user_rank_finished_idx',
      'battle_record_archives_archived_idx',
    ]
    const missing = expected.filter((name) => !names.has(name))
    return { healthy: missing.length === 0, indexes: [...names], missing }
  }
}

module.exports = {
  PgAccountRepository,
  PgInviteCodeRepository,
  PgAdminAuditRepository,
  PgBattleRecordRepository,
}

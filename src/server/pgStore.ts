// Postgres 实现（Supabase）：云端部署使用。表名统一带 royale_ 前缀，可与旧版的表共存于同一个库。
import pg from 'pg'
import type { LeaderboardRow, LedgerItem, MatchRecord } from '../shared/protocol.ts'
import {
  BoardKind, MatchDetail, MatchInsert, MatchPlayerInsert, MatchRow, NewUser, Store, StoreStats, USER_EXTRA_COLUMNS, UserRow, toMatchRecord,
} from './store.ts'

// bigint（金币、毫秒时间戳）按数字返回
pg.types.setTypeParser(20, Number)

export const PG_SCHEMA = `
create table if not exists royale_users (
  id text primary key,
  username text,
  pass_hash text,
  pass_salt text,
  nickname text not null,
  avatar integer not null default 0,
  is_guest integer not null default 0,
  coins bigint not null default 0,
  honor integer not null default 0,
  exp integer not null default 0,
  games integer not null default 0,
  wins integer not null default 0,
  caught integer not null default 0,
  leopards integer not null default 0,
  best_win bigint not null default 0,
  signin_day integer not null default 0,
  signin_streak integer not null default 0,
  relief_day integer not null default 0,
  relief_count integer not null default 0,
  created_at bigint not null,
  last_login_at bigint not null
);
create unique index if not exists royale_users_username_key on royale_users (lower(username));
create index if not exists royale_users_honor_idx on royale_users (honor desc);
create table if not exists royale_sessions (
  token_hash text primary key,
  user_id text not null,
  expires_at bigint not null
);
create table if not exists royale_matches (
  id text primary key,
  hall_id text not null,
  stake integer not null,
  finished_at bigint not null,
  detail jsonb not null
);
create table if not exists royale_match_players (
  match_id text not null,
  user_id text not null,
  seat integer not null,
  placement integer not null,
  total integer not null,
  coins_delta bigint not null,
  honor_delta integer not null,
  finished_at bigint not null,
  primary key (match_id, user_id)
);
create index if not exists royale_match_players_user_idx on royale_match_players (user_id, finished_at desc);
create table if not exists royale_ledger (
  id bigserial primary key,
  user_id text not null,
  delta bigint not null,
  balance bigint not null,
  reason text not null,
  created_at bigint not null
);
create index if not exists royale_ledger_user_idx on royale_ledger (user_id, id desc);
create table if not exists royale_friends (
  user_id text not null,
  friend_id text not null,
  created_at bigint not null,
  primary key (user_id, friend_id)
);
create table if not exists royale_rooms (
  id text primary key,
  data text not null,
  updated_at bigint not null
);
${USER_EXTRA_COLUMNS.map(([name, type]) => `alter table royale_users add column if not exists ${name} ${type};`).join('\n')}
create index if not exists royale_users_reg_ip_idx on royale_users (reg_ip, created_at);
alter table royale_friends enable row level security;
alter table royale_rooms enable row level security;
alter table royale_users enable row level security;
alter table royale_sessions enable row level security;
alter table royale_matches enable row level security;
alter table royale_match_players enable row level security;
alter table royale_ledger enable row level security;
`

/**
 * Hyperdrive 默认会把只读查询的结果缓存约 60 秒，金币、签到、会话这类数据必须读到最新值。
 * 含 now() 这类非确定函数的查询不会被缓存，所以所有读取都带上这个恒真条件。
 */
const FRESH = 'now() is not null'

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }> // eslint-disable-line @typescript-eslint/no-explicit-any
}

const USER_COLUMNS = new Set<string>([
  'username', 'pass_hash', 'pass_salt', 'nickname', 'avatar', 'is_guest', 'coins', 'honor', 'exp', 'games', 'wins', 'caught',
  'leopards', 'best_win', 'signin_day', 'signin_streak', 'relief_day', 'relief_count', 'last_login_at',
  ...USER_EXTRA_COLUMNS.map(([name]) => name),
])
const BOARD_COLUMN: Record<BoardKind, string> = { honor: 'honor', coins: 'coins', wins: 'wins' }

export class PgStore implements Store {
  constructor(private q: Queryable, private pool?: pg.Pool) {}

  static create(connectionString: string, ssl: boolean): PgStore {
    const pool = new pg.Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: ssl ? { rejectUnauthorized: false } : false,
    })
    pool.on('error', (error) => console.error('Postgres 连接池错误:', error.message))
    return new PgStore(pool, pool)
  }

  async migrate(): Promise<void> {
    await this.q.query(PG_SCHEMA)
  }

  async tx<T>(fn: (store: Store) => Promise<T>): Promise<T> {
    if (!this.pool) return fn(this) // 已在事务中
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const result = await fn(new PgStore(client))
      await client.query('commit')
      return result
    } catch (error) {
      await client.query('rollback').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async getUser(id: string): Promise<UserRow | undefined> {
    return (await this.q.query(`select * from royale_users where id = $1 and ${FRESH}`, [id])).rows[0]
  }

  async getUserByUsername(username: string): Promise<UserRow | undefined> {
    return (await this.q.query(`select * from royale_users where lower(username) = lower($1) and ${FRESH}`, [username])).rows[0]
  }

  async insertUser(user: NewUser): Promise<void> {
    const now = Date.now()
    await this.q.query(
      `insert into royale_users (id, username, pass_hash, pass_salt, nickname, avatar, is_guest, coins, created_at, last_login_at, reg_ip, recovery_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11)`,
      [user.id, user.username, user.pass_hash, user.pass_salt, user.nickname, user.avatar, user.is_guest, user.coins, now, user.reg_ip ?? null, user.recovery_hash ?? null],
    )
  }

  async updateUser(id: string, fields: Partial<UserRow>): Promise<void> {
    const keys = Object.keys(fields).filter((key) => USER_COLUMNS.has(key)) as (keyof UserRow)[]
    if (keys.length === 0) return
    const sets = keys.map((key, index) => `${key} = $${index + 2}`).join(', ')
    await this.q.query(`update royale_users set ${sets} where id = $1`, [id, ...keys.map((key) => fields[key])])
  }

  async addCoins(userId: string, delta: number, reason: string): Promise<number> {
    if (delta === 0) return 0
    // 单条语句内完成"不低于 0"的扣减，避免并发下读到旧余额
    const { rows } = await this.q.query(
      `with old as (select coins from royale_users where id = $1 for update),
            upd as (update royale_users set coins = greatest(0, coins + $2) where id = $1 returning coins)
       select old.coins as before, upd.coins as after from old, upd`,
      [userId, delta],
    )
    if (rows.length === 0) return 0
    const applied = rows[0].after - rows[0].before
    await this.q.query(
      'insert into royale_ledger (user_id, delta, balance, reason, created_at) values ($1, $2, $3, $4, $5)',
      [userId, applied, rows[0].after, reason, Date.now()],
    )
    return applied
  }

  async listLedger(userId: string, limit = 30): Promise<LedgerItem[]> {
    const { rows } = await this.q.query(
      `select id, delta, balance, reason, created_at from royale_ledger where user_id = $1 and ${FRESH} order by id desc limit $2`,
      [userId, limit],
    )
    return rows.map((row) => ({ id: Number(row.id), delta: row.delta, balance: row.balance, reason: row.reason, createdAt: row.created_at }))
  }

  async insertSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
    await this.q.query('insert into royale_sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [tokenHash, userId, expiresAt])
  }

  async getSessionUserId(tokenHash: string): Promise<string | undefined> {
    const { rows } = await this.q.query(`select user_id from royale_sessions where token_hash = $1 and expires_at > $2 and ${FRESH}`, [tokenHash, Date.now()])
    return rows[0]?.user_id
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.q.query('delete from royale_sessions where token_hash = $1', [tokenHash])
  }

  async purgeExpiredSessions(): Promise<void> {
    await this.q.query('delete from royale_sessions where expires_at < $1', [Date.now()])
  }

  async insertMatch(match: MatchInsert): Promise<void> {
    await this.q.query(
      'insert into royale_matches (id, hall_id, stake, finished_at, detail) values ($1, $2, $3, $4, $5::jsonb)',
      [match.id, match.hallId, match.stake, match.finishedAt, JSON.stringify(match.detail)],
    )
  }

  async insertMatchPlayer(row: MatchPlayerInsert): Promise<void> {
    await this.q.query(
      `insert into royale_match_players (match_id, user_id, seat, placement, total, coins_delta, honor_delta, finished_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [row.matchId, row.userId, row.seat, row.placement, row.total, row.coinsDelta, row.honorDelta, row.finishedAt],
    )
  }

  async listMatches(userId: string, limit = 20): Promise<MatchRecord[]> {
    const { rows } = await this.q.query(
      `select m.id, m.hall_id, m.stake, m.finished_at, m.detail, p.placement, p.total, p.coins_delta, p.honor_delta
       from royale_match_players p join royale_matches m on m.id = p.match_id
       where p.user_id = $1 and ${FRESH} order by p.finished_at desc limit $2`,
      [userId, limit],
    )
    return (rows as MatchRow[]).map((row) => toMatchRecord(row, userId))
  }

  async getMatchDetail(matchId: string, userId: string): Promise<MatchDetail | undefined> {
    const { rows } = await this.q.query(
      `select m.detail from royale_matches m join royale_match_players p on p.match_id = m.id
       where m.id = $1 and p.user_id = $2 and ${FRESH}`,
      [matchId, userId],
    )
    const detail = rows[0]?.detail
    return typeof detail === 'string' ? JSON.parse(detail) : detail
  }

  async leaderboard(kind: BoardKind, limit = 30): Promise<LeaderboardRow[]> {
    const column = BOARD_COLUMN[kind] ?? 'honor'
    const { rows } = await this.q.query(
      `select id, nickname, avatar, honor, coins, wins, games from royale_users
       where games > 0 and is_guest = 0 and banned = 0 and ${FRESH} order by ${column} desc, games asc, created_at asc limit $1`,
      [limit],
    )
    return rows.map((row, index) => ({ ...row, rank: index + 1 }))
  }

  async rankOf(userId: string, kind: BoardKind): Promise<number> {
    const column = BOARD_COLUMN[kind] ?? 'honor'
    const user = await this.getUser(userId)
    if (!user || user.games === 0 || user.is_guest || user.banned) return 0
    const { rows } = await this.q.query(`select count(*)::int as ahead from royale_users where games > 0 and is_guest = 0 and banned = 0 and ${column} > $1 and ${FRESH}`, [user[column as 'honor']])
    return rows[0].ahead + 1
  }

  async countUsersByIp(ip: string, since: number, guest: boolean): Promise<number> {
    const { rows } = await this.q.query(
      `select count(*)::int as n from royale_users where reg_ip = $1 and created_at > $2 and is_guest = $3 and ${FRESH}`,
      [ip, since, guest ? 1 : 0],
    )
    return rows[0].n
  }

  async deleteUserSessions(userId: string): Promise<void> {
    await this.q.query('delete from royale_sessions where user_id = $1', [userId])
  }

  async addFriend(userId: string, friendId: string): Promise<void> {
    await this.q.query(
      'insert into royale_friends (user_id, friend_id, created_at) values ($1, $2, $3) on conflict do nothing',
      [userId, friendId, Date.now()],
    )
  }

  async removeFriend(userId: string, friendId: string): Promise<void> {
    await this.q.query('delete from royale_friends where user_id = $1 and friend_id = $2', [userId, friendId])
  }

  async listFriends(userId: string): Promise<UserRow[]> {
    const { rows } = await this.q.query(
      `select u.* from royale_friends f join royale_users u on u.id = f.friend_id
       where f.user_id = $1 and ${FRESH} order by f.created_at desc limit 100`,
      [userId],
    )
    return rows
  }

  async searchUsers(keyword: string, limit = 30): Promise<UserRow[]> {
    const like = `%${keyword.replace(/[%_\\]/g, '')}%`
    const { rows } = await this.q.query(
      `select * from royale_users where (id = $1 or username ilike $2 or nickname ilike $2) and ${FRESH}
       order by last_login_at desc limit $3`,
      [keyword, like, limit],
    )
    return rows
  }

  async stats(dayStart: number): Promise<StoreStats> {
    const { rows } = await this.q.query(
      `select
         (select count(*) from royale_users)::int as users,
         (select count(*) from royale_users where is_guest = 1)::int as guests,
         (select count(*) from royale_users where created_at >= $1)::int as "newToday",
         (select count(*) from royale_matches where finished_at >= $1)::int as "matchesToday",
         (select count(*) from royale_matches)::int as "matchesTotal",
         (select coalesce(sum(coins), 0) from royale_users)::bigint as "coinsTotal"
       where ${FRESH}`,
      [dayStart],
    )
    return rows[0]
  }

  async saveRoom(id: string, data: string): Promise<void> {
    await this.q.query(
      `insert into royale_rooms (id, data, updated_at) values ($1, $2, $3)
       on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at`,
      [id, data, Date.now()],
    )
  }

  async deleteRoom(id: string): Promise<void> {
    await this.q.query('delete from royale_rooms where id = $1', [id])
  }

  async listRooms(): Promise<{ id: string; data: string; updated_at: number }[]> {
    return (await this.q.query(`select id, data, updated_at from royale_rooms where ${FRESH}`)).rows
  }

  /** 写一次心跳，顺带保持 Supabase 免费项目活跃 */
  async ping(): Promise<void> {
    await this.q.query('select now()')
  }
}

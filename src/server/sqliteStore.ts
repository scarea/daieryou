// SQLite 实现（Node 内置 node:sqlite，零原生依赖）：本地开发与单机部署使用。
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { LeaderboardRow, LedgerItem, MatchRecord } from '../shared/protocol.ts'
import {
  BoardKind, MatchDetail, MatchInsert, MatchPlayerInsert, MatchRow, NewUser, Store, StoreStats, USER_EXTRA_COLUMNS, UserRow, toMatchRecord,
} from './store.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE COLLATE NOCASE,
  pass_hash TEXT,
  pass_salt TEXT,
  nickname TEXT NOT NULL,
  avatar INTEGER NOT NULL DEFAULT 0,
  is_guest INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  honor INTEGER NOT NULL DEFAULT 0,
  exp INTEGER NOT NULL DEFAULT 0,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  caught INTEGER NOT NULL DEFAULT 0,
  leopards INTEGER NOT NULL DEFAULT 0,
  best_win INTEGER NOT NULL DEFAULT 0,
  signin_day INTEGER NOT NULL DEFAULT 0,
  signin_streak INTEGER NOT NULL DEFAULT 0,
  relief_day INTEGER NOT NULL DEFAULT 0,
  relief_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  hall_id TEXT NOT NULL,
  stake INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS match_players (
  match_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  seat INTEGER NOT NULL,
  placement INTEGER NOT NULL,
  total INTEGER NOT NULL,
  coins_delta INTEGER NOT NULL,
  honor_delta INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_match_players_user ON match_players(user_id, finished_at DESC);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, id DESC);
CREATE TABLE IF NOT EXISTS friends (
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`

class SyncSqlite {
  readonly db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;')
    this.db.exec(SCHEMA)
    const existing = new Set((this.db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((column) => column.name))
    for (const [name, type] of USER_EXTRA_COLUMNS) {
      if (!existing.has(name)) this.db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`)
    }
  }

  // ------------------------------ 用户 ------------------------------

  getUser(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  }

  getUserByUsername(username: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined
  }

  insertUser(user: NewUser): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO users (id, username, pass_hash, pass_salt, nickname, avatar, is_guest, coins, created_at, last_login_at, reg_ip, recovery_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(user.id, user.username, user.pass_hash, user.pass_salt, user.nickname, user.avatar, user.is_guest, user.coins, now, now, user.reg_ip ?? null, user.recovery_hash ?? null)
  }

  updateUser(id: string, fields: Partial<UserRow>): void {
    const keys = Object.keys(fields) as (keyof UserRow)[]
    if (keys.length === 0) return
    const sql = `UPDATE users SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`
    this.db.prepare(sql).run(...keys.map((key) => fields[key] as string | number | null), id)
  }

  /** 变更金币并记流水；余额不会低于 0。返回实际变动值。 */
  addCoins(userId: string, delta: number, reason: string): number {
    const user = this.getUser(userId)
    if (!user) return 0
    const balance = Math.max(0, user.coins + delta)
    const applied = balance - user.coins
    if (applied === 0 && delta === 0) return 0
    this.db.prepare('UPDATE users SET coins = ? WHERE id = ?').run(balance, userId)
    this.db
      .prepare('INSERT INTO ledger (user_id, delta, balance, reason, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, applied, balance, reason, Date.now())
    return applied
  }

  listLedger(userId: string, limit = 30): LedgerItem[] {
    const rows = this.db
      .prepare('SELECT id, delta, balance, reason, created_at FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?')
      .all(userId, limit) as { id: number; delta: number; balance: number; reason: string; created_at: number }[]
    return rows.map((row) => ({ id: row.id, delta: row.delta, balance: row.balance, reason: row.reason, createdAt: row.created_at }))
  }

  // ------------------------------ 会话 ------------------------------

  insertSession(tokenHash: string, userId: string, expiresAt: number): void {
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash, userId, expiresAt)
  }

  getSessionUserId(tokenHash: string): string | undefined {
    const row = this.db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(tokenHash) as
      | { user_id: string; expires_at: number }
      | undefined
    if (!row) return undefined
    if (row.expires_at < Date.now()) {
      this.deleteSession(tokenHash)
      return undefined
    }
    return row.user_id
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
  }

  purgeExpiredSessions(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
  }

  // ------------------------------ 战绩 ------------------------------

  insertMatch(match: MatchInsert): void {
    this.db
      .prepare('INSERT INTO matches (id, hall_id, stake, finished_at, detail) VALUES (?, ?, ?, ?, ?)')
      .run(match.id, match.hallId, match.stake, match.finishedAt, JSON.stringify(match.detail))
  }

  insertMatchPlayer(row: MatchPlayerInsert): void {
    this.db
      .prepare(
        `INSERT INTO match_players (match_id, user_id, seat, placement, total, coins_delta, honor_delta, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.matchId, row.userId, row.seat, row.placement, row.total, row.coinsDelta, row.honorDelta, row.finishedAt)
  }

  listMatches(userId: string, limit = 20): MatchRecord[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.hall_id, m.stake, m.finished_at, m.detail, p.placement, p.total, p.coins_delta, p.honor_delta
         FROM match_players p JOIN matches m ON m.id = p.match_id
         WHERE p.user_id = ? ORDER BY p.finished_at DESC LIMIT ?`,
      )
      .all(userId, limit) as unknown as MatchRow[]
    return rows.map((row) => toMatchRecord(row, userId))
  }

  getMatchDetail(matchId: string, userId: string): MatchDetail | undefined {
    const row = this.db
      .prepare('SELECT m.detail FROM matches m JOIN match_players p ON p.match_id = m.id WHERE m.id = ? AND p.user_id = ?')
      .get(matchId, userId) as { detail: string } | undefined
    return row ? (JSON.parse(row.detail) as MatchDetail) : undefined
  }

  // ------------------------------ 排行榜 ------------------------------

  leaderboard(kind: BoardKind, limit = 30): LeaderboardRow[] {
    const column = kind === 'coins' ? 'coins' : kind === 'wins' ? 'wins' : 'honor'
    const rows = this.db
      .prepare(
        `SELECT id, nickname, avatar, honor, coins, wins, games FROM users
         WHERE games > 0 AND is_guest = 0 AND banned = 0 ORDER BY ${column} DESC, games ASC, created_at ASC LIMIT ?`,
      )
      .all(limit) as Omit<LeaderboardRow, 'rank'>[]
    return rows.map((row, index) => ({ ...row, rank: index + 1 }))
  }

  rankOf(userId: string, kind: BoardKind): number {
    const column = kind === 'coins' ? 'coins' : kind === 'wins' ? 'wins' : 'honor'
    const user = this.getUser(userId)
    if (!user || user.games === 0 || user.is_guest || user.banned) return 0
    const row = this.db
      .prepare(`SELECT COUNT(*) AS ahead FROM users WHERE games > 0 AND is_guest = 0 AND banned = 0 AND ${column} > ?`)
      .get(user[column]) as { ahead: number }
    return row.ahead + 1
  }

  // ------------------------------ 风控 / 好友 / 后台 / 房间存档 ------------------------------

  countUsersByIp(ip: string, since: number, guest: boolean): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users WHERE reg_ip = ? AND created_at > ? AND is_guest = ?').get(ip, since, guest ? 1 : 0) as { n: number }
    return row.n
  }

  deleteUserSessions(userId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  }

  addFriend(userId: string, friendId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id, created_at) VALUES (?, ?, ?)').run(userId, friendId, Date.now())
  }

  removeFriend(userId: string, friendId: string): void {
    this.db.prepare('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(userId, friendId)
  }

  listFriends(userId: string): UserRow[] {
    return this.db
      .prepare('SELECT u.* FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY f.created_at DESC LIMIT 100')
      .all(userId) as unknown as UserRow[]
  }

  searchUsers(keyword: string, limit = 30): UserRow[] {
    const like = `%${keyword.replace(/[%_]/g, '')}%`
    return this.db
      .prepare('SELECT * FROM users WHERE id = ? OR username LIKE ? OR nickname LIKE ? ORDER BY last_login_at DESC LIMIT ?')
      .all(keyword, like, like, limit) as unknown as UserRow[]
  }

  stats(dayStart: number): StoreStats {
    const one = (sql: string, ...params: number[]) => (this.db.prepare(sql).get(...params) as { n: number | null }).n ?? 0
    return {
      users: one('SELECT COUNT(*) AS n FROM users'),
      guests: one('SELECT COUNT(*) AS n FROM users WHERE is_guest = 1'),
      newToday: one('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', dayStart),
      matchesToday: one('SELECT COUNT(*) AS n FROM matches WHERE finished_at >= ?', dayStart),
      matchesTotal: one('SELECT COUNT(*) AS n FROM matches'),
      coinsTotal: one('SELECT SUM(coins) AS n FROM users'),
    }
  }

  saveRoom(id: string, data: string): void {
    this.db.prepare('INSERT INTO rooms (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').run(id, data, Date.now())
  }

  deleteRoom(id: string): void {
    this.db.prepare('DELETE FROM rooms WHERE id = ?').run(id)
  }

  listRooms(): { id: string; data: string; updated_at: number }[] {
    return this.db.prepare('SELECT id, data, updated_at FROM rooms').all() as unknown as { id: string; data: string; updated_at: number }[]
  }
}

/** 把同步的 SQLite 包成异步接口。事务内的 await 都在微任务里完成，不会被其他请求插入。 */
export class SqliteStore implements Store {
  private inner: SyncSqlite
  constructor(path: string) {
    this.inner = new SyncSqlite(path)
  }
  async tx<T>(fn: (store: Store) => Promise<T>): Promise<T> {
    this.inner.db.exec('BEGIN IMMEDIATE')
    try {
      const result = await fn(this)
      this.inner.db.exec('COMMIT')
      return result
    } catch (error) {
      this.inner.db.exec('ROLLBACK')
      throw error
    }
  }
  async getUser(id: string) { return this.inner.getUser(id) }
  async getUserByUsername(username: string) { return this.inner.getUserByUsername(username) }
  async insertUser(user: NewUser) { this.inner.insertUser(user) }
  async updateUser(id: string, fields: Partial<UserRow>) { this.inner.updateUser(id, fields) }
  async addCoins(userId: string, delta: number, reason: string) { return this.inner.addCoins(userId, delta, reason) }
  async listLedger(userId: string, limit?: number): Promise<LedgerItem[]> { return this.inner.listLedger(userId, limit) }
  async insertSession(tokenHash: string, userId: string, expiresAt: number) { this.inner.insertSession(tokenHash, userId, expiresAt) }
  async getSessionUserId(tokenHash: string) { return this.inner.getSessionUserId(tokenHash) }
  async deleteSession(tokenHash: string) { this.inner.deleteSession(tokenHash) }
  async purgeExpiredSessions() { this.inner.purgeExpiredSessions() }
  async insertMatch(match: MatchInsert) { this.inner.insertMatch(match) }
  async insertMatchPlayer(row: MatchPlayerInsert) { this.inner.insertMatchPlayer(row) }
  async listMatches(userId: string, limit?: number): Promise<MatchRecord[]> { return this.inner.listMatches(userId, limit) }
  async getMatchDetail(matchId: string, userId: string) { return this.inner.getMatchDetail(matchId, userId) }
  async leaderboard(kind: BoardKind, limit?: number): Promise<LeaderboardRow[]> { return this.inner.leaderboard(kind, limit) }
  async rankOf(userId: string, kind: BoardKind) { return this.inner.rankOf(userId, kind) }
  async countUsersByIp(ip: string, since: number, guest: boolean) { return this.inner.countUsersByIp(ip, since, guest) }
  async deleteUserSessions(userId: string) { this.inner.deleteUserSessions(userId) }
  async addFriend(userId: string, friendId: string) { this.inner.addFriend(userId, friendId) }
  async removeFriend(userId: string, friendId: string) { this.inner.removeFriend(userId, friendId) }
  async listFriends(userId: string) { return this.inner.listFriends(userId) }
  async searchUsers(keyword: string, limit?: number) { return this.inner.searchUsers(keyword, limit) }
  async stats(dayStart: number) { return this.inner.stats(dayStart) }
  async saveRoom(id: string, data: string) { this.inner.saveRoom(id, data) }
  async deleteRoom(id: string) { this.inner.deleteRoom(id) }
  async listRooms() { return this.inner.listRooms() }
}

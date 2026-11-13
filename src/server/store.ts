// 数据持久层接口：本地用 SQLite，云端用 Postgres（Supabase），二者实现同一套异步接口。
import type { LeaderboardRow, LedgerItem, MatchRecord, UserProfile } from '../shared/protocol.ts'

export interface UserRow {
  id: string
  username: string | null
  pass_hash: string | null
  pass_salt: string | null
  nickname: string
  avatar: number
  is_guest: number
  coins: number
  honor: number
  exp: number
  games: number
  wins: number
  caught: number
  leopards: number
  best_win: number
  signin_day: number
  signin_streak: number
  relief_day: number
  relief_count: number
  created_at: number
  last_login_at: number
  reg_ip: string | null
  is_admin: number
  banned: number
  recovery_hash: string | null
  /** JSON 数组：已拥有的商城物品 */
  items: string
  frame: string
  cardback: string
  felt: string
  day_key: number
  day_games: number
  day_wins: number
  /** JSON 数组：今日已领取的任务 */
  day_claimed: string
  /** JSON 数组：已领取的成就 */
  ach_claimed: string
  season: string
  /** 加密后的 DeepSeek API Key、展示用掩码、所选模型 */
  ai_key: string
  ai_mask: string
  ai_model: string
}

export function parseList(text: string | null | undefined): string[] {
  try {
    const value = JSON.parse(text || '[]')
    return Array.isArray(value) ? value.map(String) : []
  } catch {
    return []
  }
}

export interface MatchDetail {
  players: { userId: string; nickname: string; avatar: number; total: number; isBot: boolean }[]
  rounds: { round: number; deltas: number[]; hands: string[] }[]
  game?: string
  summary?: string
  /** 麻将牌谱等附加数据 */
  record?: unknown
}

export function toProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    avatar: row.avatar,
    isGuest: row.is_guest === 1,
    coins: row.coins,
    honor: row.honor,
    exp: row.exp,
    games: row.games,
    wins: row.wins,
    caught: row.caught,
    leopards: row.leopards,
    bestWin: row.best_win,
    createdAt: row.created_at,
    isAdmin: row.is_admin === 1,
    items: parseList(row.items),
    frame: row.frame || '',
    cardback: row.cardback || '',
    felt: row.felt || '',
    aiKeyMask: row.ai_mask || '',
    aiModel: row.ai_model || '',
  }
}

export type BoardKind = 'honor' | 'coins' | 'wins'
export type NewUser = Pick<UserRow, 'id' | 'username' | 'pass_hash' | 'pass_salt' | 'nickname' | 'avatar' | 'is_guest' | 'coins'> & { reg_ip?: string | null; recovery_hash?: string | null }
export interface MatchInsert { id: string; hallId: string; stake: number; finishedAt: number; detail: MatchDetail }
export interface MatchPlayerInsert { matchId: string; userId: string; seat: number; placement: number; total: number; coinsDelta: number; honorDelta: number; finishedAt: number }

export interface Store {
  /** 在事务中执行；回调拿到绑定了该事务的 Store，抛错则回滚 */
  tx<T>(fn: (store: Store) => Promise<T>): Promise<T>
  getUser(id: string): Promise<UserRow | undefined>
  getUserByUsername(username: string): Promise<UserRow | undefined>
  insertUser(user: NewUser): Promise<void>
  updateUser(id: string, fields: Partial<UserRow>): Promise<void>
  /** 变更金币并记流水；余额不会低于 0。返回实际变动值。 */
  addCoins(userId: string, delta: number, reason: string): Promise<number>
  listLedger(userId: string, limit?: number): Promise<LedgerItem[]>
  insertSession(tokenHash: string, userId: string, expiresAt: number): Promise<void>
  getSessionUserId(tokenHash: string): Promise<string | undefined>
  deleteSession(tokenHash: string): Promise<void>
  purgeExpiredSessions(): Promise<void>
  insertMatch(match: MatchInsert): Promise<void>
  insertMatchPlayer(row: MatchPlayerInsert): Promise<void>
  listMatches(userId: string, limit?: number): Promise<MatchRecord[]>
  /** 取某一局的完整详情；只有参与者能取到 */
  getMatchDetail(matchId: string, userId: string): Promise<MatchDetail | undefined>
  leaderboard(kind: BoardKind, limit?: number): Promise<LeaderboardRow[]>
  rankOf(userId: string, kind: BoardKind): Promise<number>
  /** 某 IP 在 since 之后创建的账号数（guest=true 只算游客，false 只算正式账号） */
  countUsersByIp(ip: string, since: number, guest: boolean): Promise<number>
  deleteUserSessions(userId: string): Promise<void>
  addFriend(userId: string, friendId: string): Promise<void>
  removeFriend(userId: string, friendId: string): Promise<void>
  listFriends(userId: string): Promise<UserRow[]>
  searchUsers(keyword: string, limit?: number): Promise<UserRow[]>
  stats(dayStart: number): Promise<StoreStats>
  saveRoom(id: string, data: string): Promise<void>
  deleteRoom(id: string): Promise<void>
  listRooms(): Promise<{ id: string; data: string; updated_at: number }[]>
}

export interface StoreStats {
  users: number
  guests: number
  newToday: number
  matchesToday: number
  matchesTotal: number
  coinsTotal: number
}

/** 新增的用户字段（旧库升级时逐列补上） */
export const USER_EXTRA_COLUMNS: [string, string][] = [
  ['reg_ip', 'text'],
  ['is_admin', 'integer not null default 0'],
  ['banned', 'integer not null default 0'],
  ['recovery_hash', 'text'],
  ['items', "text not null default '[]'"],
  ['frame', "text not null default ''"],
  ['cardback', "text not null default ''"],
  ['felt', "text not null default ''"],
  ['day_key', 'integer not null default 0'],
  ['day_games', 'integer not null default 0'],
  ['day_wins', 'integer not null default 0'],
  ['day_claimed', "text not null default '[]'"],
  ['ach_claimed', "text not null default '[]'"],
  ['season', "text not null default ''"],
  ['ai_key', "text not null default ''"],
  ['ai_mask', "text not null default ''"],
  ['ai_model', "text not null default ''"],
]

export interface MatchRow {
  id: string; hall_id: string; stake: number; finished_at: number; detail: string | MatchDetail
  placement: number; total: number; coins_delta: number; honor_delta: number
}

export function toMatchRecord(row: MatchRow, userId: string): MatchRecord {
  const detail = (typeof row.detail === 'string' ? JSON.parse(row.detail) : row.detail) as MatchDetail
  return {
    id: row.id,
    hallId: row.hall_id,
    stake: row.stake,
    finishedAt: row.finished_at,
    placement: row.placement,
    total: row.total,
    coinsDelta: row.coins_delta,
    honorDelta: row.honor_delta,
    players: detail.players.map((player) => ({
      nickname: player.nickname, avatar: player.avatar, total: player.total, isBot: player.isBot, me: player.userId === userId,
    })),
    rounds: detail.rounds,
    game: detail.game,
    summary: detail.summary,
  }
}

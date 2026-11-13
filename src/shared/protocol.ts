// 前后端共享的数据结构与消息协议。
import type { GameView, RoundResult } from './engine.ts'
import type { MjOptions } from './mahjong/game.ts'
import type { MjAction, MjLevel, MjView } from './mahjong/view.ts'

export interface UserProfile {
  id: string
  username: string | null
  nickname: string
  avatar: number
  isGuest: boolean
  coins: number
  honor: number
  exp: number
  games: number
  /** 整局头名次数 */
  wins: number
  /** 被逮（单轮第二名）次数 */
  caught: number
  leopards: number
  /** 单局最高赢取金币 */
  bestWin: number
  createdAt: number
  isAdmin: boolean
  /** 已拥有的商城物品 id */
  items: string[]
  /** 当前装备：头像框 / 牌背 / 桌布（空串为默认） */
  frame: string
  cardback: string
  felt: string
  /** AI 教练（DeepSeek）：已保存的 API Key 掩码，空串表示未设置 */
  aiKeyMask: string
  aiModel: string
}

export type BotLevel = 'easy' | 'normal' | 'hard' | 'peek'

export const BOT_LEVEL_NAME: Record<BotLevel, string> = {
  easy: '新手',
  normal: '老手',
  hard: '高手',
  peek: '千王·透视',
}

export interface SeatInfo {
  seat: number
  userId: string
  nickname: string
  avatar: number
  frame: string
  isBot: boolean
  botLevel?: BotLevel
  online: boolean
  /** 托管中（离线或主动离开，由 AI 代打） */
  trustee: boolean
  coins: number | null
  honor: number
  /** 结算后是否已点"再来一局" */
  ready: boolean
}

export type RoomStatus = 'waiting' | 'playing' | 'finished'

export interface SettlementEntry {
  seat: number
  total: number
  placement: number
  coinsDelta: number
  honorDelta: number
  expGain: number
}

export interface RoomView {
  id: string
  hallId: string
  stake: number
  isPrivate: boolean
  /** 快速匹配中的牌桌：到时自动补机器人开局 */
  matching: boolean
  spectators: number
  status: RoomStatus
  hostSeat: number
  seats: (SeatInfo | null)[]
  mySeat: number
  /** 当前阶段截止时间（服务器时钟，毫秒） */
  deadlineAt: number | null
  serverNow: number
  game: GameView | null
  settlement: SettlementEntry[] | null
}

export interface LobbyRoom {
  id: string
  hallId: string
  stake: number
  status: RoomStatus
  hostName: string
  players: { nickname: string; avatar: number; isBot: boolean }[]
}

export interface LobbyState {
  rooms: LobbyRoom[]
  online: number
}

export interface MatchRecord {
  id: string
  hallId: string
  stake: number
  finishedAt: number
  placement: number
  total: number
  coinsDelta: number
  honorDelta: number
  players: { nickname: string; avatar: number; total: number; isBot: boolean; me: boolean }[]
  rounds: { round: number; deltas: number[]; hands: string[] }[]
  /** 游戏类型：空为逮二游，mahjong 为红中麻将 */
  game?: string
  summary?: string
}

export interface LedgerItem {
  id: number
  delta: number
  balance: number
  reason: string
  createdAt: number
}

export interface LeaderboardRow {
  rank: number
  id: string
  nickname: string
  avatar: number
  honor: number
  coins: number
  wins: number
  games: number
}

export interface SigninStatus {
  /** 今日是否已签到 */
  signedToday: boolean
  /** 已连续签到天数（含今日，若已签） */
  streak: number
  /** 下一次（或今日）签到对应第几天奖励，0 起 */
  nextIndex: number
  reliefLeft: number
}

export interface FriendInfo {
  id: string
  nickname: string
  avatar: number
  frame: string
  honor: number
  online: boolean
  /** 好友所在的公开牌桌（私密牌桌不显示） */
  room: { id: string; status: RoomStatus; joinable: boolean } | null
}

export interface AdminUser {
  id: string
  username: string | null
  nickname: string
  avatar: number
  isGuest: boolean
  isAdmin: boolean
  banned: boolean
  coins: number
  honor: number
  games: number
  createdAt: number
  lastLoginAt: number
  online: boolean
}

export interface AdminStats {
  users: number
  guests: number
  newToday: number
  matchesToday: number
  matchesTotal: number
  coinsTotal: number
  online: number
  rooms: number
}

// ------------------------------ WebSocket 消息 ------------------------------

export type ClientOp =
  | { op: 'auth'; token: string }
  | { op: 'lobby' }
  | { op: 'quick'; hallId: string; botLevel: BotLevel }
  | { op: 'create'; hallId: string; isPrivate: boolean }
  | { op: 'join'; roomId: string }
  | { op: 'match'; hallId: string }
  | { op: 'spectate'; roomId: string }
  | { op: 'leave' }
  | { op: 'addBot'; level: BotLevel }
  | { op: 'kick'; seat: number }
  | { op: 'start' }
  | { op: 'again' }
  | { op: 'play'; round: number; cardIds: string[] }
  | { op: 'emote'; key: string }
  | { op: 'mj:start'; hallId: string; level: MjLevel; options: MjOptions }
  | { op: 'mj:act'; action: MjAction }
  | { op: 'mj:next' }
  | { op: 'mj:leave' }
  | { op: 'ping' }

export type ClientMessage = ClientOp & { id: number }

export type ServerEvent =
  | { ev: 'res'; id: number; ok: true; data?: unknown }
  | { ev: 'res'; id: number; ok: false; error: string }
  | { ev: 'room'; room: RoomView | null }
  | { ev: 'lobby'; lobby: LobbyState }
  | { ev: 'me'; user: UserProfile }
  | { ev: 'mj'; table: MjView | null }
  | { ev: 'emote'; seat: number; key: string }
  | { ev: 'notice'; text: string }
  | { ev: 'kicked'; reason: string }

export const EMOTES: Record<string, string> = {
  nice: '好牌！',
  hurry: '快点吧，等到花儿都谢了',
  caught: '逮住你了！',
  unlucky: '手气太背了…',
  thanks: '承让承让',
  bluff: '你敢跟吗？',
  laugh: '哈哈哈',
  again: '再来一局！',
}

export type { GameView, RoundResult }

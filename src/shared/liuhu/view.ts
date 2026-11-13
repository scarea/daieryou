// 六胡抢：前后端共享的牌桌视图。所有座位号都换算成以"我"为 0 号位（我在下方，1 右、2 对家、3 左）。
import type { FlipRound, LhAction, LhChoices, LhDecision, LhEvent, LhMeld, LhResult } from './game.ts'

export type LhLevel = 'easy' | 'normal' | 'hard' | 'master'

export const LH_LEVELS: LhLevel[] = ['easy', 'normal', 'hard', 'master']
export const LH_LEVEL_NAME: Record<LhLevel, string> = { easy: '入门', normal: '进阶', hard: '高手', master: '大师' }
export const LH_LEVEL_DESC: Record<LhLevel, string> = {
  easy: '入门：见牌就吃碰，随手出牌，适合熟悉流程',
  normal: '进阶：会留搭子、凑门子，偶尔打错',
  hard: '高手：吃碰有取舍，尽量打熟牌，不轻易放炮',
  master: '大师：算胡数、盯场面，危险的生牌宁可拆搭也不打',
}

export interface LhSeatView {
  seat: number
  empty: boolean
  userId: string
  online: boolean
  trustee: boolean
  ready: boolean
  name: string
  avatar: number
  frame: string
  isBot: boolean
  handCount: number
  /** 结束后亮出的手牌；对局中为 null */
  hand: number[] | null
  /** 别人的提是扣着的：对局中 kind 与牌面为 -1 */
  melds: LhMeld[]
  /** 右手边的牌 */
  discards: number[]
  /** 桌面上看得见的胡数 */
  hu: number
  score: number
  total: number
}

export interface LhSettlement {
  matchId: string
  coinsDelta: number
  honorDelta: number
  expGain: number
}

export interface LhView {
  roomId: string
  mode: 'practice' | 'room'
  isPrivate: boolean
  matching: boolean
  hostSeat: number
  deadlineAt: number | null
  serverNow: number
  hallId: string
  stake: number
  level: LhLevel
  handNo: number
  /** waiting：等人入座；flip：翻牌定庄；discard：等人打牌；claim：等人表态（胡 / 碰 / 吃） */
  phase: 'waiting' | 'flip' | 'discard' | 'claim' | 'over'
  flip: FlipRound[] | null
  dealer: number
  /** 当前该谁操作；没有为 -1 */
  actor: number
  wallCount: number
  hand: number[]
  choices: LhChoices
  seats: LhSeatView[]
  /** 亮在桌上等人表态的牌 */
  shown: { tile: number; from: number; source: 'open' | 'draw' | 'discard' } | null
  result: LhResult | null
  settlement: LhSettlement | null
  seq: number
  lastEvent: LhEvent | null
  /** 结束后附带我这一局的每一次决定，供复盘 */
  record: LhRecord | null
}

export interface LhRecord {
  /** 我的每一次决定（座位已换算成以我为 0 号位） */
  decisions: LhDecision[]
  level: LhLevel
}

export type { LhAction }

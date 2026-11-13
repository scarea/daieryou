// 红中麻将：前后端共享的牌桌视图与消息。
import type { DiceRound, KongPayment, Meld, MjAction, MjChoices, MjEvent, MjOptions, MjResult, MjState } from './game.ts'

export type MjLevel = 'easy' | 'normal' | 'hard' | 'master'

export const MJ_LEVELS: MjLevel[] = ['easy', 'normal', 'hard', 'master']
export const MJ_LEVEL_NAME: Record<MjLevel, string> = { easy: '入门', normal: '进阶', hard: '高手', master: '大师' }
export const MJ_LEVEL_DESC: Record<MjLevel, string> = {
  easy: '入门：凭感觉出牌，见牌就碰，适合熟悉流程',
  normal: '进阶：会算向听数，偶尔打错牌',
  hard: '高手：每一手都按进张最多来打，碰杠有取舍',
  master: '大师：在高手基础上多算一步改良，并留意场上已现的牌',
}

export interface MjSeatView {
  seat: number
  name: string
  avatar: number
  frame: string
  isBot: boolean
  handCount: number
  /** 结束后亮出的手牌；对局中为 null */
  hand: number[] | null
  /** 别人的暗杠在对局中看不到牌面（kind 为 -1） */
  melds: Meld[]
  discards: number[]
  /** 本局分数变化 */
  score: number
  /** 本桌累计分数 */
  total: number
}

export interface MjSettlement {
  matchId: string
  coinsDelta: number
  honorDelta: number
  expGain: number
}

export interface MjView {
  hallId: string
  stake: number
  level: MjLevel
  options: MjOptions
  handNo: number
  /** dice：掷骰定庄动画中 */
  phase: 'dice' | 'play' | 'claim' | 'over'
  dice: DiceRound[] | null
  dealer: number
  turn: number
  wallCount: number
  /** 我的座位固定为 0 */
  hand: number[]
  drawn: number | null
  choices: MjChoices
  seats: MjSeatView[]
  lastDiscard: { seat: number; tile: number } | null
  /** 正在等哪一家决定碰 / 杠 */
  claimSeat: number
  kongs: KongPayment[]
  result: MjResult | null
  settlement: MjSettlement | null
  /** 刚发生的事件及其序号，客户端据此播放动画与音效 */
  seq: number
  lastEvent: MjEvent | null
  /** 结束后附带完整牌谱，供复盘 */
  record: MjRecord | null
}

export interface MjRecord {
  init: MjState['init']
  events: MjEvent[]
  options: MjOptions
  names: string[]
  level: MjLevel
}

export type { MjAction }

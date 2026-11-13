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
  /** 等待阶段的空座位 */
  empty: boolean
  userId: string
  online: boolean
  /** 托管中：掉线或离开，由机器人代打 */
  trustee: boolean
  /** 结算后是否已点「下一局」 */
  ready: boolean
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
  /** 6 位房号 */
  roomId: string
  /** practice：单人对机器人；room：真人房间（好友约局 / 快速匹配） */
  mode: 'practice' | 'room'
  isPrivate: boolean
  /** 快速匹配中：到时由机器人补齐 */
  matching: boolean
  /** 房主的座位（以我为 0 号位的相对座位） */
  hostSeat: number
  /** 当前操作的截止时间（服务器时钟）；没有限时为 null */
  deadlineAt: number | null
  serverNow: number
  hallId: string
  stake: number
  level: MjLevel
  options: MjOptions
  handNo: number
  /** waiting：等人入座；dice：掷骰定庄动画中 */
  phase: 'waiting' | 'dice' | 'play' | 'claim' | 'over'
  dice: DiceRound[] | null
  dealer: number
  turn: number
  wallCount: number
  /** 所有座位号都已换算成以我为 0 号位（我在下方，1 右、2 对家、3 左） */
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

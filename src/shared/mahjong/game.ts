// 红中麻将对局引擎（纯逻辑，无 IO）。
//
// 规则：
//  - 4 人，112 张牌（万条筒 + 4 红中），红中是癞子。每人 13 张，庄家多摸 1 张先出。
//  - 不能吃；可以碰、杠。只能自摸胡，没有点炮，也没有抢杠胡。
//  - 杠当场结算：补杠（碰后摸到第 4 张）三家各付 1 分；放杠（别人打出、手里三张去杠）放杠的人付 3 分；暗杠三家各付 2 分。
//  - 胡牌后抓 1 只鸟：不分万条筒，一点 / 九点 / 红中 = 10 分，其余 = 点数 + 1。三家各付这个分数。
//  - 杀鬼：胡牌时手里没有红中，分数翻倍。
//  - 首局掷骰定庄：每人掷两颗骰子，点数最大者坐庄（并列者重掷）。之后赢家坐庄；流局庄家连庄。
import { WinOptions, canWin, isShaGui } from './hand.ts'
import { ZHONG, allTiles, birdScore, countKinds, kindOf } from './tiles.ts'

export const SEATS = 4
export const HAND_SIZE = 13

export interface MjOptions extends WinOptions {
  /** 红中能否打出 */
  zhongDiscard: boolean
}

export const DEFAULT_OPTIONS: MjOptions = { sevenPairs: true, fourZhong: true, zhongDiscard: true }

export type MeldType = 'pung' | 'kong' | 'ankan' | 'bukan'

export interface Meld {
  /** pung 碰；kong 放杠（明杠）；ankan 暗杠；bukan 补杠 */
  type: MeldType
  kind: number
  tiles: number[]
  /** 碰 / 放杠的牌来自哪一家 */
  from?: number
}

export interface MjPlayer {
  hand: number[]
  melds: Meld[]
  /** 打出的牌；被碰 / 杠走的不在其中 */
  discards: number[]
  /** 本局分数变化 */
  score: number
}

export type MjAction =
  | { type: 'discard'; tile: number }
  | { type: 'hu' }
  | { type: 'ankan'; kind: number }
  | { type: 'bukan'; kind: number }
  | { type: 'pung' }
  | { type: 'kong' }
  | { type: 'pass' }

export interface KongPayment {
  seat: number
  type: 'kong' | 'ankan' | 'bukan'
  kind: number
  /** 每个座位的分数变化 */
  deltas: number[]
}

export interface MjResult {
  /** 赢家座位；流局为 -1 */
  winner: number
  shaGui: boolean
  /** 抓到的鸟（牌 id）；流局为 -1 */
  bird: number
  birdScore: number
  /** 胡牌每家付的分数（已含杀鬼翻倍） */
  perPlayer: number
  /** 胡牌那一笔的各家分数变化 */
  winDeltas: number[]
  nextDealer: number
}

export type MjEvent =
  | { t: 'draw'; seat: number; tile: number; tail?: boolean }
  | { t: 'discard'; seat: number; tile: number }
  | { t: 'pung' | 'kong'; seat: number; from: number; tile: number }
  | { t: 'ankan' | 'bukan'; seat: number; kind: number }
  | { t: 'pass'; seat: number }
  | { t: 'hu'; seat: number }
  | { t: 'drawn-game' }

export interface MjState {
  options: MjOptions
  players: MjPlayer[]
  wall: number[]
  dealer: number
  turn: number
  /** play：轮到 turn 出牌或杠 / 胡；claim：等某家决定是否碰 / 杠；over：本局结束 */
  phase: 'play' | 'claim' | 'over'
  /** 当前玩家刚摸到的牌（碰牌后为 null：只能出牌） */
  drawn: number | null
  lastDiscard: { seat: number; tile: number } | null
  claim: { seat: number; pung: boolean; kong: boolean } | null
  kongs: KongPayment[]
  result: MjResult | null
  /** 开局时的完整信息 + 事件序列，供复盘重放 */
  init: { hands: number[][]; wall: number[]; dealer: number }
  events: MjEvent[]
}

// ------------------------------ 掷骰定庄 ------------------------------

export interface DiceRound {
  /** 参与本轮的座位 */
  seats: number[]
  /** 每个参与座位掷出的两颗骰子 */
  rolls: [number, number][]
}

/** 每人掷两颗骰子，合计最大者坐庄；并列最大的人继续掷，直到分出胜负 */
export function rollForDealer(random: () => number = Math.random): { rounds: DiceRound[]; dealer: number } {
  const die = () => 1 + Math.floor(random() * 6)
  const rounds: DiceRound[] = []
  let seats = [0, 1, 2, 3]
  for (;;) {
    const rolls = seats.map(() => [die(), die()] as [number, number])
    rounds.push({ seats, rolls })
    const best = Math.max(...rolls.map(([a, b]) => a + b))
    const top = seats.filter((_, index) => rolls[index][0] + rolls[index][1] === best)
    if (top.length === 1) return { rounds, dealer: top[0] }
    seats = top
  }
}

// ------------------------------ 发牌 ------------------------------

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function dealGame(dealer: number, options: MjOptions = DEFAULT_OPTIONS, random: () => number = Math.random): MjState {
  return startFrom(shuffle(allTiles(), random), dealer, options)
}

/** 用指定的牌墙开局（测试与复盘重放用）。牌墙从头摸牌，杠后从尾部补牌。 */
export function startFrom(deck: number[], dealer: number, options: MjOptions = DEFAULT_OPTIONS): MjState {
  const wall = [...deck]
  const hands: number[][] = [[], [], [], []]
  for (let round = 0; round < HAND_SIZE; round += 1) {
    for (let offset = 0; offset < SEATS; offset += 1) hands[(dealer + offset) % SEATS].push(wall.shift() as number)
  }
  const state: MjState = {
    options,
    players: hands.map((hand) => ({ hand: [...hand], melds: [], discards: [], score: 0 })),
    wall,
    dealer,
    turn: dealer,
    phase: 'play',
    drawn: null,
    lastDiscard: null,
    claim: null,
    kongs: [],
    result: null,
    init: { hands: hands.map((hand) => [...hand]), wall: [...wall], dealer },
    events: [],
  }
  drawTile(state, dealer, false)
  return state
}

// ------------------------------ 内部工具 ------------------------------

function drawTile(state: MjState, seat: number, fromTail: boolean): void {
  if (state.wall.length === 0) {
    // 牌摸完没人胡：流局，庄家连庄
    state.phase = 'over'
    state.drawn = null
    state.claim = null
    state.result = { winner: -1, shaGui: false, bird: -1, birdScore: 0, perPlayer: 0, winDeltas: [0, 0, 0, 0], nextDealer: state.dealer }
    state.events.push({ t: 'drawn-game' })
    return
  }
  const tile = fromTail ? (state.wall.pop() as number) : (state.wall.shift() as number)
  state.players[seat].hand.push(tile)
  state.turn = seat
  state.drawn = tile
  state.phase = 'play'
  state.claim = null
  state.events.push(fromTail ? { t: 'draw', seat, tile, tail: true } : { t: 'draw', seat, tile })
}

function payKong(state: MjState, seat: number, type: KongPayment['type'], kind: number, from?: number): void {
  const deltas = [0, 0, 0, 0]
  if (type === 'kong' && from !== undefined) {
    deltas[from] -= 3
    deltas[seat] += 3
  } else {
    const each = type === 'ankan' ? 2 : 1
    for (let other = 0; other < SEATS; other += 1) {
      if (other === seat) continue
      deltas[other] -= each
      deltas[seat] += each
    }
  }
  deltas.forEach((delta, index) => { state.players[index].score += delta })
  state.kongs.push({ seat, type, kind, deltas })
}

function removeKind(hand: number[], kind: number, count: number): number[] {
  const removed: number[] = []
  for (let i = hand.length - 1; i >= 0 && removed.length < count; i -= 1) {
    if (kindOf(hand[i]) === kind) removed.push(...hand.splice(i, 1))
  }
  return removed
}

const countOf = (hand: number[], kind: number) => hand.reduce((sum, tile) => sum + (kindOf(tile) === kind ? 1 : 0), 0)

// ------------------------------ 可用操作 ------------------------------

export interface MjChoices {
  /** 可以打出的牌（id） */
  discards: number[]
  hu: boolean
  ankan: number[]
  bukan: number[]
  pung: boolean
  kong: boolean
  pass: boolean
}

const NONE: MjChoices = { discards: [], hu: false, ankan: [], bukan: [], pung: false, kong: false, pass: false }

export function choicesFor(state: MjState, seat: number): MjChoices {
  if (state.phase === 'claim') {
    if (state.claim?.seat !== seat) return NONE
    return { ...NONE, pung: state.claim.pung, kong: state.claim.kong, pass: true }
  }
  if (state.phase !== 'play' || state.turn !== seat) return NONE
  const player = state.players[seat]
  const hand = player.hand
  const nonZhong = hand.filter((tile) => kindOf(tile) !== ZHONG)
  // 不许打红中时，除非手里只剩红中
  const discards = state.options.zhongDiscard || nonZhong.length === 0 ? [...hand] : nonZhong
  // 碰牌之后没有摸牌：只能出牌
  if (state.drawn === null) return { ...NONE, discards }

  const counts = countKinds(hand)
  const canKong = state.wall.length > 0
  const ankan: number[] = []
  const bukan: number[] = []
  if (canKong) {
    for (let kind = 0; kind < ZHONG; kind += 1) {
      if (counts[kind] === 4) ankan.push(kind)
      if (counts[kind] >= 1 && player.melds.some((meld) => meld.type === 'pung' && meld.kind === kind)) bukan.push(kind)
    }
  }
  return { ...NONE, discards, hu: canWin(counts, player.melds.length, state.options), ankan, bukan }
}

// ------------------------------ 执行操作 ------------------------------

export function applyAction(state: MjState, seat: number, action: MjAction): void {
  const choices = choicesFor(state, seat)
  const player = state.players[seat]
  switch (action.type) {
    case 'discard': {
      if (!choices.discards.includes(action.tile)) throw new Error('不能打这张牌')
      player.hand.splice(player.hand.indexOf(action.tile), 1)
      player.discards.push(action.tile)
      state.drawn = null
      state.lastDiscard = { seat, tile: action.tile }
      state.events.push({ t: 'discard', seat, tile: action.tile })
      const kind = kindOf(action.tile)
      // 只能碰 / 杠，且红中不能碰杠。一张牌最多只有一家能碰。
      if (kind !== ZHONG) {
        for (let offset = 1; offset < SEATS; offset += 1) {
          const other = (seat + offset) % SEATS
          const have = countOf(state.players[other].hand, kind)
          if (have >= 2) {
            state.phase = 'claim'
            state.claim = { seat: other, pung: true, kong: have >= 3 && state.wall.length > 0 }
            return
          }
        }
      }
      drawTile(state, (seat + 1) % SEATS, false)
      return
    }
    case 'pass': {
      if (!choices.pass || !state.lastDiscard) throw new Error('现在不能过')
      state.events.push({ t: 'pass', seat })
      drawTile(state, (state.lastDiscard.seat + 1) % SEATS, false)
      return
    }
    case 'pung':
    case 'kong': {
      const isKong = action.type === 'kong'
      if (!(isKong ? choices.kong : choices.pung) || !state.lastDiscard) throw new Error(isKong ? '现在不能杠' : '现在不能碰')
      const { seat: from, tile } = state.lastDiscard
      const kind = kindOf(tile)
      const taken = removeKind(player.hand, kind, isKong ? 3 : 2)
      state.players[from].discards.pop()
      player.melds.push({ type: action.type, kind, tiles: [...taken, tile], from })
      state.events.push({ t: action.type, seat, from, tile })
      state.lastDiscard = null
      state.claim = null
      if (isKong) {
        payKong(state, seat, 'kong', kind, from)
        drawTile(state, seat, true)
      } else {
        state.turn = seat
        state.phase = 'play'
        state.drawn = null
      }
      return
    }
    case 'ankan': {
      if (!choices.ankan.includes(action.kind)) throw new Error('现在不能暗杠')
      player.melds.push({ type: 'ankan', kind: action.kind, tiles: removeKind(player.hand, action.kind, 4) })
      state.events.push({ t: 'ankan', seat, kind: action.kind })
      payKong(state, seat, 'ankan', action.kind)
      drawTile(state, seat, true)
      return
    }
    case 'bukan': {
      if (!choices.bukan.includes(action.kind)) throw new Error('现在不能补杠')
      const meld = player.melds.find((item) => item.type === 'pung' && item.kind === action.kind) as Meld
      meld.type = 'bukan'
      meld.tiles.push(...removeKind(player.hand, action.kind, 1))
      state.events.push({ t: 'bukan', seat, kind: action.kind })
      payKong(state, seat, 'bukan', action.kind)
      drawTile(state, seat, true)
      return
    }
    case 'hu': {
      if (!choices.hu) throw new Error('还不能胡')
      const shaGui = isShaGui(countKinds(player.hand))
      // 抓鸟：翻牌墙的下一张；牌墙已空则以胡的那张牌为鸟
      const bird = state.wall.length > 0 ? (state.wall.shift() as number) : (state.drawn as number)
      const score = birdScore(kindOf(bird))
      const perPlayer = score * (shaGui ? 2 : 1)
      const winDeltas = [0, 0, 0, 0]
      for (let other = 0; other < SEATS; other += 1) {
        if (other === seat) continue
        winDeltas[other] -= perPlayer
        winDeltas[seat] += perPlayer
      }
      winDeltas.forEach((delta, index) => { state.players[index].score += delta })
      state.events.push({ t: 'hu', seat })
      state.phase = 'over'
      state.claim = null
      state.result = { winner: seat, shaGui, bird, birdScore: score, perPlayer, winDeltas, nextDealer: seat }
      return
    }
    default:
      throw new Error('未知操作')
  }
}

/** 某个座位能看到的牌（自己的手牌、所有人的弃牌与碰杠）的各牌种张数 */
export function visibleCounts(state: MjState, seat: number): number[] {
  const counts = countKinds(state.players[seat].hand)
  for (const player of state.players) {
    for (const tile of player.discards) counts[kindOf(tile)] += 1
    for (const meld of player.melds) {
      // 别人的暗杠看不到是什么牌
      if (meld.type === 'ankan' && player !== state.players[seat]) continue
      counts[meld.kind] += meld.tiles.length
    }
  }
  return counts
}

/** 各牌种在该座位看不到的地方还剩几张 */
export function remainingFor(state: MjState, seat: number): number[] {
  return visibleCounts(state, seat).map((seen) => Math.max(0, 4 - seen))
}

/** 用开局信息和事件序列重放到第 upto 个事件之前的局面（复盘用） */
export function replay(init: MjState['init'], events: MjEvent[], options: MjOptions, upto = events.length): MjState {
  const deck: number[] = []
  for (let round = 0; round < HAND_SIZE; round += 1) {
    for (let offset = 0; offset < SEATS; offset += 1) deck.push(init.hands[(init.dealer + offset) % SEATS][round])
  }
  const state = startFrom([...deck, ...init.wall], init.dealer, options)
  // startFrom 自己记了庄家的第一次摸牌，对应 events[0]
  for (let index = 1; index < upto; index += 1) {
    const event = events[index]
    if (event.t === 'discard') applyAction(state, event.seat, { type: 'discard', tile: event.tile })
    else if (event.t === 'pung' || event.t === 'kong') applyAction(state, event.seat, { type: event.t })
    else if (event.t === 'ankan' || event.t === 'bukan') applyAction(state, event.seat, { type: event.t, kind: event.kind })
    else if (event.t === 'pass') applyAction(state, event.seat, { type: 'pass' })
    else if (event.t === 'hu') applyAction(state, event.seat, { type: 'hu' })
  }
  return state
}

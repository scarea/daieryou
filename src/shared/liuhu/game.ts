// 常宁六胡抢对局引擎（纯逻辑，无 IO）。
//
// 流程：
//  - 4 人，80 张字牌。庄家 15 张（最后一张亮出，叫挡底），闲家 14 张。
//  - 庄家起手有提（四张）当场亮出，然后打一张；闲家的提要等到自己摸牌的回合才亮。
//  - 之后轮流从墩上摸牌。摸的牌不入手：先亮出来，
//      摸牌的人能胡可以胡 → 能提 / 跑 / 笑必须做 → 别家能胡可以胡 → 别家能跑必须跑
//      → 别家可以碰 → 摸牌的人、他的下家可以吃 → 都不要就放到摸牌人的右手边，下家接着摸。
//  - 打出的牌：别家能胡可以胡（放炮）→ 能跑必须跑 → 可以碰 → 下家可以吃。
//  - 吃 / 碰 / 笑之后必须打一张。第一次提 / 跑打一张，之后的"重跑"不打。
//  - 想吃没吃、能碰没碰，这张牌就成了自己的臭牌，之后不能再吃 / 碰同样的牌。
//  - 墩上的牌摸完没人胡：荒庄，庄家连庄。
//
// 算分：每份 = 胡数 × 倍数（红黑倍数，自摸再 ×2）。为了不出小数，底分按 3 分计。
//  - 自摸：三家各付一份；放炮：放炮的人一人付三份；胡别人摸出来的牌 / 挡底：三家各付一份，不翻倍。
import { ChiOption, GroupType, LH_RULES, LhGroup, LhRules, TableMeld, checkWin, chiGroup, chiOptions, isFour, makeGroup } from './hand.ts'
import { LH_TOTAL, lhKind, lhRank, redMultiplier } from './tiles.ts'

export const LH_SEATS = 4

export interface LhMeld extends TableMeld {
  /** 被吃 / 碰 / 跑的那张牌来自哪一家 */
  from?: number
}

export interface LhPlayer {
  hand: number[]
  melds: LhMeld[]
  /** 右手边的牌：自己打出的、自己摸出来没人要的 */
  discards: number[]
  /** 臭牌：放弃过吃 / 碰的牌种 */
  stinkChi: number[]
  stinkPeng: number[]
  score: number
}

export type LhAction =
  | { type: 'discard'; tile: number }
  | { type: 'hu' }
  | { type: 'peng' }
  | { type: 'chi'; option: number }
  | { type: 'pass' }

export type LhEvent =
  | { t: 'open'; seat: number; tile: number }
  | { t: 'draw'; seat: number; tile: number }
  | { t: 'discard'; seat: number; tile: number }
  | { t: 'meld'; seat: number; type: GroupType; kind: number; from: number; again: boolean }
  | { t: 'chi'; seat: number; from: number; tile: number; groups: number }
  | { t: 'pass'; seat: number }
  | { t: 'drop'; seat: number; tile: number }
  | { t: 'hu'; seat: number; from: number }
  | { t: 'drawn-game' }

export type WinKind = 'zimo' | 'pao' | 'gong'

export interface LhResult {
  /** 赢家座位；荒庄为 -1 */
  winner: number
  /** zimo 自摸；pao 放炮；gong 胡别人摸出的牌或挡底 */
  kind: WinKind
  /** 放炮的人；其余情况为 -1 */
  loser: number
  tile: number
  hu: number
  reds: number
  redName: string
  /** 总倍数（红黑倍数 × 自摸 2） */
  mult: number
  /** 每份的分数 */
  share: number
  groups: LhGroup[]
  deltas: number[]
  nextDealer: number
}

type StepKind = 'hu' | 'meld' | 'peng' | 'chi'

interface Step {
  seat: number
  kind: StepKind
}

export interface LhPending {
  tile: number
  /** 这张牌是谁摸出来 / 打出来的 */
  from: number
  /** open：挡底；draw：摸出来的；discard：打出来的 */
  source: 'open' | 'draw' | 'discard'
  steps: Step[]
}

export interface LhState {
  rules: LhRules
  players: LhPlayer[]
  wall: number[]
  dealer: number
  /** discard 阶段：该谁打牌；claim 阶段：这张牌是谁的 */
  turn: number
  phase: 'discard' | 'claim' | 'over'
  pending: LhPending | null
  /** 刚打出、正在等别家表态的牌 / 刚摸出亮在桌上的牌 */
  result: LhResult | null
  init: { hands: number[][]; wall: number[]; dealer: number }
  events: LhEvent[]
}

// ------------------------------ 定庄 ------------------------------

export interface FlipRound {
  seats: number[]
  /** 每人翻出的牌（id） */
  tiles: number[]
}

/** 首局倒牌比大小：每人翻一张，点数最大的坐庄；并列的人再翻 */
export function flipForDealer(random: () => number = Math.random): { rounds: FlipRound[]; dealer: number } {
  const rounds: FlipRound[] = []
  let seats = [0, 1, 2, 3]
  for (;;) {
    const deck = shuffle(Array.from({ length: LH_TOTAL }, (_, id) => id), random)
    const tiles = seats.map((_, index) => deck[index])
    rounds.push({ seats, tiles })
    const best = Math.max(...tiles.map((tile) => lhRank(lhKind(tile))))
    const top = seats.filter((_, index) => lhRank(lhKind(tiles[index])) === best)
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

export function dealLiuhu(dealer: number, rules: LhRules = LH_RULES, random: () => number = Math.random): LhState {
  return startLiuhu(shuffle(Array.from({ length: LH_TOTAL }, (_, id) => id), random), dealer, rules)
}

/** 用指定的牌序开局（测试用）：每人轮流发 14 张，庄家再拿一张挡底，剩下的是墩 */
export function startLiuhu(deck: number[], dealer: number, rules: LhRules = LH_RULES): LhState {
  const wall = [...deck]
  const hands: number[][] = [[], [], [], []]
  for (let round = 0; round < 14; round += 1) {
    for (let offset = 0; offset < LH_SEATS; offset += 1) hands[(dealer + offset) % LH_SEATS].push(wall.shift() as number)
  }
  const bottom = wall.shift() as number
  hands[dealer].push(bottom)
  return fromHands(hands, wall, dealer, rules)
}

/** 用指定的手牌开局（测试用）：庄家手牌的最后一张是挡底 */
export function fromHands(hands: number[][], wall: number[], dealer: number, rules: LhRules = LH_RULES): LhState {
  const state: LhState = {
    rules,
    players: hands.map((hand) => ({ hand: [...hand], melds: [], discards: [], stinkChi: [], stinkPeng: [], score: 0 })),
    wall: [...wall],
    dealer,
    turn: dealer,
    phase: 'claim',
    pending: null,
    result: null,
    init: { hands: hands.map((hand) => [...hand]), wall: [...wall], dealer },
    events: [],
  }
  const bottom = hands[dealer][hands[dealer].length - 1]
  state.events.push({ t: 'open', seat: dealer, tile: bottom })
  // 挡底：庄家自己成牌可以胡；闲家正好缺这张也可以胡
  const steps: Step[] = []
  if (checkWin([], state.players[dealer].hand, null, true, rules)) steps.push({ seat: dealer, kind: 'hu' })
  for (let offset = 1; offset < LH_SEATS; offset += 1) {
    const seat = (dealer + offset) % LH_SEATS
    if (checkWin([], state.players[seat].hand, bottom, false, rules)) steps.push({ seat, kind: 'hu' })
  }
  state.pending = { tile: bottom, from: dealer, source: 'open', steps }
  resolve(state)
  return state
}

// ------------------------------ 内部工具 ------------------------------

const countOf = (hand: number[], kind: number) => hand.reduce((sum, tile) => sum + (lhKind(tile) === kind ? 1 : 0), 0)

function removeKind(hand: number[], kind: number, count: number): number[] {
  const removed: number[] = []
  for (let i = hand.length - 1; i >= 0 && removed.length < count; i -= 1) {
    if (lhKind(hand[i]) === kind) removed.push(...hand.splice(i, 1))
  }
  return removed
}

const foursOf = (player: LhPlayer) => player.melds.filter((meld) => isFour(meld.type)).length
const totalTiles = (player: LhPlayer) => player.hand.length + player.melds.reduce((sum, meld) => sum + meld.tiles.length, 0)

/** 该不该打牌：第一次提 / 跑打一张，重跑不打——每多一个四张的门子，可以多留一张 */
function mustDiscard(player: LhPlayer): boolean {
  return player.hand.length > 0 && totalTiles(player) > 14 + Math.max(0, foursOf(player) - 1)
}

/** 可以打出的牌：起手的坎不能拆（除非手里只剩坎） */
export function discardable(player: LhPlayer): number[] {
  const free = player.hand.filter((tile) => countOf(player.hand, lhKind(tile)) < 3)
  return free.length > 0 ? free : [...player.hand]
}

function meld(type: GroupType, kind: number, tiles: number[], rules: LhRules, from?: number): LhMeld {
  return { type, kind, tiles, hu: makeGroup(type, tiles.map(lhKind), rules).hu, ...(from === undefined ? {} : { from }) }
}

/** 这张牌进来后必须做的事：提 / 跑 / 笑。没有则返回 null */
function forcedMeld(player: LhPlayer, kind: number, self: boolean): GroupType | null {
  const have = countOf(player.hand, kind)
  if (have === 3) return self ? 'ti' : 'pao'
  const shown = player.melds.find((item) => item.kind === kind && (item.type === 'peng' || item.type === 'xiao'))
  if (shown) return shown.type === 'xiao' && self ? 'ti' : 'pao'
  if (have === 2 && self) return 'xiao'
  return null
}

function applyForced(state: LhState, seat: number, tile: number, from: number): void {
  const player = state.players[seat]
  const kind = lhKind(tile)
  const type = forcedMeld(player, kind, seat === from) as GroupType
  const again = isFour(type) && foursOf(player) > 0
  const shown = player.melds.find((item) => item.kind === kind && (item.type === 'peng' || item.type === 'xiao'))
  if (shown && isFour(type)) {
    shown.type = type
    shown.tiles.push(tile)
    shown.hu = makeGroup(type, shown.tiles.map(lhKind), state.rules).hu
  } else {
    const taken = removeKind(player.hand, kind, type === 'xiao' ? 2 : 3)
    player.melds.push(meld(type, kind, [...taken, tile], state.rules, seat === from ? undefined : from))
  }
  state.events.push({ t: 'meld', seat, type, kind, from, again })
}

/** 闲家起手的提，轮到自己摸牌时亮出来；庄家开局当场亮 */
function revealTi(state: LhState, seat: number): void {
  const player = state.players[seat]
  for (;;) {
    const tile = player.hand.find((item) => countOf(player.hand, lhKind(item)) === 4)
    if (tile === undefined) return
    const kind = lhKind(tile)
    const again = foursOf(player) > 0
    player.melds.push(meld('ti', kind, removeKind(player.hand, kind, 4), state.rules))
    state.events.push({ t: 'meld', seat, type: 'ti', kind, from: seat, again })
  }
}

function toDiscard(state: LhState, seat: number): void {
  state.pending = null
  state.turn = seat
  if (mustDiscard(state.players[seat])) {
    state.phase = 'discard'
    return
  }
  drawFor(state, (seat + 1) % LH_SEATS)
}

function drawFor(state: LhState, seat: number): void {
  state.turn = seat
  revealTi(state, seat)
  if (state.wall.length === 0) {
    state.phase = 'over'
    state.pending = null
    state.result = {
      winner: -1, kind: 'zimo', loser: -1, tile: -1, hu: 0, reds: 0, redName: '', mult: 0, share: 0, groups: [],
      deltas: [0, 0, 0, 0], nextDealer: state.dealer,
    }
    state.events.push({ t: 'drawn-game' })
    return
  }
  const tile = state.wall.shift() as number
  state.events.push({ t: 'draw', seat, tile })
  expose(state, tile, seat, 'draw')
}

/** 一张牌亮在桌上：排出各家按先后顺序可以做的事 */
function expose(state: LhState, tile: number, from: number, source: 'draw' | 'discard'): void {
  const kind = lhKind(tile)
  const steps: Step[] = []
  const others = [1, 2, 3].map((offset) => (from + offset) % LH_SEATS)
  const drawer = state.players[from]
  let taken = false

  if (source === 'draw') {
    if (checkWin(drawer.melds, drawer.hand, tile, true, state.rules)) steps.push({ seat: from, kind: 'hu' })
    if (forcedMeld(drawer, kind, true)) {
      steps.push({ seat: from, kind: 'meld' })
      taken = true
    }
  }
  if (!taken) {
    for (const seat of others) {
      const player = state.players[seat]
      if (checkWin(player.melds, player.hand, tile, false, state.rules)) steps.push({ seat, kind: 'hu' })
    }
    const runner = others.find((seat) => forcedMeld(state.players[seat], kind, false))
    if (runner !== undefined) {
      steps.push({ seat: runner, kind: 'meld' })
    } else {
      for (const seat of others) {
        const player = state.players[seat]
        // 碰完要有牌可打
        if (countOf(player.hand, kind) === 2 && player.hand.length > 2 && !player.stinkPeng.includes(kind)) steps.push({ seat, kind: 'peng' })
      }
      const eaters = source === 'draw' ? [from, others[0]] : [others[0]]
      for (const seat of eaters) {
        if (!state.players[seat].stinkChi.includes(kind) && chiChoices(state.players[seat], tile).length > 0) steps.push({ seat, kind: 'chi' })
      }
    }
  }
  state.phase = 'claim'
  state.turn = from
  state.pending = { tile, from, source, steps }
  resolve(state)
}

/** 吃法：吃完（含下伙）手里要还有牌可打 */
function chiChoices(player: LhPlayer, tile: number): ChiOption[] {
  return chiOptions(player.hand, tile).filter((option) => player.hand.length - (option.groups.length * 3 - 1) > 0)
}

/** 推进到下一个需要人决定的地方；必须做的事（提 / 跑 / 笑）自动完成 */
function resolve(state: LhState): void {
  const pending = state.pending as LhPending
  const step = pending.steps[0]
  if (step && step.kind !== 'meld') return
  if (step) {
    applyForced(state, step.seat, pending.tile, pending.from)
    toDiscard(state, step.seat)
    return
  }
  // 没有人要
  const { tile, from, source } = pending
  if (source === 'open') {
    // 挡底留在庄家手里；庄家亮出起手的提，然后打一张
    revealTi(state, from)
    toDiscard(state, from)
    return
  }
  state.players[from].discards.push(tile)
  if (source === 'draw') state.events.push({ t: 'drop', seat: from, tile })
  state.pending = null
  drawFor(state, (from + 1) % LH_SEATS)
}

// ------------------------------ 可用操作 ------------------------------

export interface LhChoices {
  /** 可以打出的牌（id） */
  discards: number[]
  hu: boolean
  peng: boolean
  /** 吃法；空数组表示不能吃 */
  chi: ChiOption[]
  pass: boolean
}

const NONE: LhChoices = { discards: [], hu: false, peng: false, chi: [], pass: false }

/** 当前该谁表态 / 打牌；结束后为 -1 */
export function actorOf(state: LhState): number {
  if (state.phase === 'over') return -1
  if (state.phase === 'discard') return state.turn
  return state.pending?.steps[0]?.seat ?? -1
}

export function choicesFor(state: LhState, seat: number): LhChoices {
  if (state.phase === 'discard') return state.turn === seat ? { ...NONE, discards: discardable(state.players[seat]) } : NONE
  if (state.phase !== 'claim' || !state.pending) return NONE
  const step = state.pending.steps[0]
  if (!step || step.seat !== seat) return NONE
  if (step.kind === 'hu') return { ...NONE, hu: true, pass: true }
  if (step.kind === 'peng') return { ...NONE, peng: true, pass: true }
  if (step.kind === 'chi') return { ...NONE, chi: chiChoices(state.players[seat], state.pending.tile), pass: true }
  return NONE
}

// ------------------------------ 执行操作 ------------------------------

function finish(state: LhState, seat: number): void {
  const pending = state.pending as LhPending
  const player = state.players[seat]
  const open = pending.source === 'open'
  const self = pending.from === seat
  // 庄家起手成牌：挡底本来就在手里
  const win = open && self
    ? checkWin(player.melds, player.hand, null, true, state.rules)
    : checkWin(player.melds, player.hand, pending.tile, self, state.rules)
  if (!win) throw new Error('还不能胡')
  const kind: WinKind = self ? 'zimo' : pending.source === 'discard' ? 'pao' : 'gong'
  const red = redMultiplier(win.reds)
  const mult = red.mult * (kind === 'zimo' ? 2 : 1)
  const share = win.hu * mult
  const deltas = [0, 0, 0, 0]
  if (kind === 'pao') {
    deltas[pending.from] -= share * 3
    deltas[seat] += share * 3
  } else {
    for (let other = 0; other < LH_SEATS; other += 1) {
      if (other === seat) continue
      deltas[other] -= share
      deltas[seat] += share
    }
  }
  deltas.forEach((delta, index) => { state.players[index].score += delta })
  state.events.push({ t: 'hu', seat, from: pending.from })
  state.phase = 'over'
  state.result = {
    winner: seat, kind, loser: kind === 'pao' ? pending.from : -1, tile: pending.tile, hu: win.hu, reds: win.reds, redName: red.name,
    mult, share, groups: win.groups, deltas, nextDealer: seat,
  }
}

export function applyLiuhu(state: LhState, seat: number, action: LhAction): void {
  const choices = choicesFor(state, seat)
  const player = state.players[seat]
  const pending = state.pending
  switch (action.type) {
    case 'discard': {
      if (!choices.discards.includes(action.tile)) throw new Error('不能打这张牌')
      player.hand.splice(player.hand.indexOf(action.tile), 1)
      state.events.push({ t: 'discard', seat, tile: action.tile })
      expose(state, action.tile, seat, 'discard')
      return
    }
    case 'hu': {
      if (!choices.hu) throw new Error('还不能胡')
      finish(state, seat)
      return
    }
    case 'pass': {
      if (!choices.pass || !pending) throw new Error('现在不能过')
      const step = pending.steps.shift() as Step
      const kind = lhKind(pending.tile)
      // 想吃没吃、能碰没碰：成了臭牌
      if (step.kind === 'peng' && !player.stinkPeng.includes(kind)) player.stinkPeng.push(kind)
      if (step.kind === 'chi' && !player.stinkChi.includes(kind)) player.stinkChi.push(kind)
      state.events.push({ t: 'pass', seat })
      resolve(state)
      return
    }
    case 'peng': {
      if (!choices.peng || !pending) throw new Error('现在不能碰')
      const kind = lhKind(pending.tile)
      const taken = removeKind(player.hand, kind, 2)
      player.melds.push(meld('peng', kind, [...taken, pending.tile], state.rules, pending.from))
      state.events.push({ t: 'meld', seat, type: 'peng', kind, from: pending.from, again: false })
      toDiscard(state, seat)
      return
    }
    case 'chi': {
      const option = choices.chi[action.option]
      if (!option || !pending) throw new Error('现在不能吃')
      option.groups.forEach((kinds, index) => {
        // 第一门包含被吃的那张，放在最前面；其余是下伙
        const need = [...kinds]
        const tiles: number[] = []
        if (index === 0) {
          need.splice(need.indexOf(lhKind(pending.tile)), 1)
          tiles.push(pending.tile)
        }
        for (const kind of need) tiles.push(...removeKind(player.hand, kind, 1))
        const group = chiGroup(kinds, state.rules)
        player.melds.push({ type: group.type, kind: lhKind(tiles[0]), tiles, hu: group.hu, ...(index === 0 ? { from: pending.from } : {}) })
      })
      state.events.push({ t: 'chi', seat, from: pending.from, tile: pending.tile, groups: option.groups.length })
      toDiscard(state, seat)
      return
    }
    default:
      throw new Error('未知操作')
  }
}

/** 某个座位看得到的各牌种张数：自己的手牌、所有人右手边的牌与亮出的门子 */
export function lhVisible(state: LhState, seat: number): number[] {
  const counts = new Array<number>(20).fill(0)
  for (const tile of state.players[seat].hand) counts[lhKind(tile)] += 1
  state.players.forEach((player, index) => {
    for (const tile of player.discards) counts[lhKind(tile)] += 1
    for (const item of player.melds) {
      // 别人的提是扣着的
      if (item.type === 'ti' && index !== seat) continue
      for (const tile of item.tiles) counts[lhKind(tile)] += 1
    }
  })
  if (state.pending && state.pending.source !== 'open') counts[lhKind(state.pending.tile)] += 1
  return counts
}

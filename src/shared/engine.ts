// 逮二游对局引擎（纯逻辑，无 IO）。
//
// 规则摘要：
//  - 3 人一桌，54 张牌，大小王为赖子。
//  - 开局每人 5 张手牌，桌面 4 张公牌（前 3 张明牌，第 4 张暗牌）。
//  - 第 1~4 轮：每人从手牌选 2 张 + 当轮公牌组成三张比大小；出过的牌不再回手。
//  - 第 1~3 轮结算后每人摸 2 张（本轮输家先摸）；第 4 轮后不摸牌。
//  - 第 5 轮：无公牌，用剩余 3 张手牌直接比。
//  - 每轮"第二名"为输家（被逮），分别向头名和末位各付一笔当轮基础分（1~5 分）。
//  - 输家与某位赢家同为豹子时，该笔翻倍。
//  - 并列：三人全平不结算；并列头名则第三名为输家；并列第二则两人都向头名付分。
import { Card, createDeck, shuffle } from './cards.ts'
import { HandEval, evaluateHand } from './hand.ts'

export const PLAYER_COUNT = 3
export const MAX_ROUNDS = 5
export const HAND_SIZE = 5
export const PUBLIC_COUNT = 4
/** 暗牌公牌所在回合（第 4 轮） */
export const HIDDEN_ROUND = 4
export const ROUND_SCORES = [1, 2, 3, 4, 5]
/** 单局理论最大输分：每轮都被逮且全部豹子翻倍 */
export const MAX_LOSS_SCORE = ROUND_SCORES.reduce((sum, score) => sum + score * 4, 0)

export type GamePhase = 'selecting' | 'showdown' | 'finished'

export interface PlayerState {
  id: string
  hand: Card[]
  /** 本轮已选的两张牌 id；未选为 null */
  picked: string[] | null
  /** 本轮是否由托管/超时代选 */
  auto: boolean
  /** 本轮新摸到的牌 */
  drawn: string[]
  total: number
  roundScores: number[]
}

export interface Transfer {
  from: number
  to: number
  amount: number
  doubled: boolean
}

export interface RoundEntry {
  seat: number
  /** 原始三张牌（含未替换的赖子） */
  cards: Card[]
  evaluation: HandEval
  /** 本轮名次（1 起，并列同名次） */
  rank: number
  delta: number
  auto: boolean
}

export interface RoundResult {
  round: number
  score: number
  publicCard: Card | null
  entries: RoundEntry[]
  winners: number[]
  losers: number[]
  transfers: Transfer[]
}

export interface GameState {
  players: PlayerState[]
  deck: Card[]
  publicCards: Card[]
  round: number
  phase: GamePhase
  results: RoundResult[]
}

export function isSelectionRound(round: number): boolean {
  return round < MAX_ROUNDS
}

export function createGame(playerIds: string[], random: () => number = Math.random): GameState {
  if (playerIds.length !== PLAYER_COUNT) throw new Error('需要 3 名玩家')
  const deck = shuffle(createDeck(), random)
  const players: PlayerState[] = playerIds.map((id) => ({
    id,
    hand: [],
    picked: null,
    auto: false,
    drawn: [],
    total: 0,
    roundScores: [],
  }))
  for (let i = 0; i < HAND_SIZE; i += 1) {
    for (const player of players) player.hand.push(deck.pop() as Card)
  }
  const publicCards: Card[] = []
  for (let i = 0; i < PUBLIC_COUNT; i += 1) publicCards.push(deck.pop() as Card)
  return { players, deck, publicCards, round: 1, phase: 'selecting', results: [] }
}

/** 当轮公牌；第 5 轮无公牌 */
export function currentPublicCard(state: GameState): Card | null {
  return isSelectionRound(state.round) ? state.publicCards[state.round - 1] ?? null : null
}

/** 玩家选牌。返回是否成功写入（重复提交同样的牌视为成功）。 */
export function pickCards(state: GameState, seat: number, cardIds: string[], auto = false): void {
  if (state.phase !== 'selecting') throw new Error('当前不在选牌阶段')
  if (!isSelectionRound(state.round)) throw new Error('最终轮无需选牌')
  const player = state.players[seat]
  if (!player) throw new Error('座位无效')
  const unique = Array.from(new Set(cardIds))
  if (unique.length !== 2) throw new Error('必须选择 2 张不同的牌')
  if (!unique.every((id) => player.hand.some((card) => card.id === id))) throw new Error('选择的牌不在手牌中')
  if (player.picked) {
    const same = player.picked.length === 2 && unique.every((id) => player.picked!.includes(id))
    if (same) return
    throw new Error('本轮已出牌，请等待其他玩家')
  }
  player.picked = unique
  player.auto = auto
}

export function allPicked(state: GameState): boolean {
  if (!isSelectionRound(state.round)) return true
  return state.players.every((player) => player.picked !== null)
}

export interface Settlement {
  ranks: number[]
  winners: number[]
  losers: number[]
  transfers: Transfer[]
  deltas: number[]
}

/** 根据三家牌型计算名次与积分流转（纯函数） */
export function settleHands(evaluations: HandEval[], score: number): Settlement {
  const order = evaluations.map((_, seat) => seat).sort((a, b) => evaluations[b].key - evaluations[a].key)
  const groups: number[][] = []
  for (const seat of order) {
    const last = groups[groups.length - 1]
    if (last && evaluations[last[0]].key === evaluations[seat].key) last.push(seat)
    else groups.push([seat])
  }

  const ranks = new Array<number>(evaluations.length).fill(1)
  groups.forEach((group, index) => group.forEach((seat) => { ranks[seat] = index + 1 }))

  const [first = [], second = [], third = []] = groups
  let winners: number[] = []
  let losers: number[] = []
  if (first.length >= 3 || second.length === 0) {
    // 三家全平：本轮不结算
  } else if (first.length === 2) {
    // 并列头名：剩下那家即为输家
    winners = first
    losers = second.slice(0, 1)
  } else if (second.length === 2) {
    // 并列第二：两家都被逮
    winners = first
    losers = second
  } else {
    winners = [...first, ...third]
    losers = second
  }

  const deltas = new Array<number>(evaluations.length).fill(0)
  const transfers: Transfer[] = []
  for (const from of losers) {
    for (const to of winners) {
      const doubled = evaluations[from].type === 'leopard' && evaluations[to].type === 'leopard'
      const amount = score * (doubled ? 2 : 1)
      transfers.push({ from, to, amount, doubled })
      deltas[from] -= amount
      deltas[to] += amount
    }
  }
  return { ranks, winners: [...winners].sort((a, b) => a - b), losers: [...losers].sort((a, b) => a - b), transfers, deltas }
}

/** 取某座位本轮参与比牌的三张牌 */
export function roundCards(state: GameState, seat: number): Card[] {
  const player = state.players[seat]
  if (isSelectionRound(state.round)) {
    const publicCard = currentPublicCard(state)
    const picked = (player.picked ?? []).map((id) => player.hand.find((card) => card.id === id)).filter(Boolean) as Card[]
    return publicCard ? [...picked, publicCard] : picked
  }
  return player.hand.slice(0, 3)
}

/** 结算当前回合：计算名次、流转积分，进入亮牌阶段 */
export function settleRound(state: GameState): RoundResult {
  if (state.phase !== 'selecting') throw new Error('当前回合已结算')
  if (!allPicked(state)) throw new Error('还有玩家未出牌')
  const score = ROUND_SCORES[state.round - 1]
  const hands = state.players.map((_, seat) => roundCards(state, seat))
  if (hands.some((hand) => hand.length !== 3)) throw new Error('回合牌面数量异常')
  const evaluations = hands.map((hand) => evaluateHand(hand))
  const settlement = settleHands(evaluations, score)

  state.players.forEach((player, seat) => {
    player.roundScores.push(settlement.deltas[seat])
    player.total += settlement.deltas[seat]
  })

  const result: RoundResult = {
    round: state.round,
    score,
    publicCard: currentPublicCard(state),
    entries: state.players.map((player, seat) => ({
      seat,
      cards: hands[seat],
      evaluation: evaluations[seat],
      rank: settlement.ranks[seat],
      delta: settlement.deltas[seat],
      auto: player.auto,
    })),
    winners: settlement.winners,
    losers: settlement.losers,
    transfers: settlement.transfers,
  }
  state.results.push(result)
  state.phase = 'showdown'
  return result
}

/** 亮牌结束后推进：弃掉已出的牌、摸牌并进入下一轮；最后一轮则结束对局 */
export function advanceRound(state: GameState): void {
  if (state.phase !== 'showdown') throw new Error('当前不在亮牌阶段')
  const finishedRound = state.round
  if (finishedRound >= MAX_ROUNDS) {
    state.phase = 'finished'
    return
  }

  for (const player of state.players) {
    const picked = new Set(player.picked ?? [])
    player.hand = player.hand.filter((card) => !picked.has(card.id))
    player.picked = null
    player.auto = false
    player.drawn = []
  }

  // 第 1~3 轮后摸牌：本轮输家先摸，其余按座位顺序；每人轮流摸 1 张，共 2 圈
  if (finishedRound < HIDDEN_ROUND) {
    const losers = state.results[state.results.length - 1]?.losers ?? []
    const order = [...losers, ...state.players.map((_, seat) => seat).filter((seat) => !losers.includes(seat))]
    for (let lap = 0; lap < 2; lap += 1) {
      for (const seat of order) {
        const card = state.deck.pop()
        if (card) {
          state.players[seat].hand.push(card)
          state.players[seat].drawn.push(card.id)
        }
      }
    }
  }

  state.round = finishedRound + 1
  state.phase = 'selecting'
}

// ---------------------------------------------------------------------------
// 面向客户端的视图（隐藏他人手牌与暗牌）
// ---------------------------------------------------------------------------

export interface SeatView {
  handCount: number
  picked: boolean
  auto: boolean
  total: number
  roundScores: number[]
}

export interface GameView {
  round: number
  phase: GamePhase
  /** 4 张公牌；暗牌在第 4 轮结算前为 null */
  publicCards: (Card | null)[]
  /** 我的手牌（旁观为空） */
  hand: Card[]
  picked: string[] | null
  drawn: string[]
  seats: SeatView[]
  results: RoundResult[]
  deckCount: number
}

export function viewFor(state: GameState, seat: number): GameView {
  const hiddenRevealed = state.results.length >= HIDDEN_ROUND
  const me = state.players[seat]
  return {
    round: state.round,
    phase: state.phase,
    publicCards: state.publicCards.map((card, index) => (index === HIDDEN_ROUND - 1 && !hiddenRevealed ? null : card)),
    hand: me ? me.hand : [],
    picked: me ? me.picked : null,
    drawn: me ? me.drawn : [],
    seats: state.players.map((player) => ({
      handCount: player.hand.length,
      picked: player.picked !== null || !isSelectionRound(state.round),
      auto: player.auto,
      total: player.total,
      roundScores: player.roundScores,
    })),
    results: state.results,
    deckCount: state.deck.length,
  }
}

/** 整局名次（按总分，从高到低；并列同名次） */
export function finalPlacements(totals: number[]): number[] {
  const sorted = [...new Set(totals)].sort((a, b) => b - a)
  return totals.map((total) => sorted.indexOf(total) + 1)
}

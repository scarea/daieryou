// 机器人出牌决策：蒙特卡洛模拟"我是不是第二名"。
// 逮二游的核心是避开第二名 —— 最大或最小都算赢，所以 AI 既会争头名，也会主动垫底。
import { Card, createDeck, shuffle } from '../shared/cards.ts'
import { HIDDEN_ROUND, ROUND_SCORES } from '../shared/engine.ts'
import { evaluateHand } from '../shared/hand.ts'
import type { BotLevel } from '../shared/protocol.ts'

export interface BotInput {
  level: BotLevel
  round: number
  hand: Card[]
  /** 当轮公牌；暗牌回合为 null */
  publicCard: Card | null
  /** 已知不在牌堆/他人手里的牌：公开的公牌、历史已亮出的牌 */
  seen: Card[]
  /** 透视难度：已知的真人玩家手牌 */
  peekHands?: Card[][]
}

const PAIRS: [number, number][] = []
for (let i = 0; i < 5; i += 1) for (let j = i + 1; j < 5; j += 1) PAIRS.push([i, j])

const SIMS: Record<BotLevel, number> = { easy: 0, normal: 50, hard: 180, peek: 140 }
let simScale = 1

/** 调整模拟次数倍率（云端免费版 CPU 时间有限时调低） */
export function setBotBudget(scale: number): void {
  simScale = Math.max(0.05, Math.min(1, scale))
}

const keyOf = (a: Card, b: Card, c: Card) => evaluateHand([a, b, c]).key

/** 我与两位对手比牌的积分变化（以 1 分为单位） */
function outcome(mine: number, o1: number, o2: number): number {
  const greater = (o1 > mine ? 1 : 0) + (o2 > mine ? 1 : 0)
  const less = (o1 < mine ? 1 : 0) + (o2 < mine ? 1 : 0)
  const equal = 2 - greater - less
  if (equal === 2) return 0
  if (equal === 1) return greater === 1 ? -1 : 1 // 并列第二：付头名一笔；并列头名：收一笔
  if (greater === 1 && less === 1) return -2
  if (o1 === o2) return greater === 2 ? -2 : 2 // 对手并列头名则我被逮；对手并列第二则都付我
  return 1
}

/** 留牌的潜力（后面回合分值更高，好牌值得留） */
function keepValue(kept: Card[]): number {
  let value = 0
  const naturals = kept.filter((card) => card.suit !== null)
  value += (kept.length - naturals.length) * 0.9
  for (let i = 0; i < naturals.length; i += 1) {
    for (let j = i + 1; j < naturals.length; j += 1) {
      const a = naturals[i]
      const b = naturals[j]
      if (a.rank === b.rank) value += 0.35
      else if (a.suit === b.suit) value += Math.abs(a.rank - b.rank) <= 2 ? 0.16 : 0.06
    }
  }
  return value
}

interface OpponentPlay {
  key: number
  kept: Card[]
}

/** 对手模型：多数时候打最大，其次打最小，偶尔随机 */
function opponentPlay(hand: Card[], publicCard: Card, random: () => number): OpponentPlay {
  let maxIndex = 0
  let minIndex = 0
  const keys = PAIRS.map(([i, j]) => keyOf(hand[i], hand[j], publicCard))
  keys.forEach((key, index) => {
    if (key > keys[maxIndex]) maxIndex = index
    if (key < keys[minIndex]) minIndex = index
  })
  const roll = random()
  const chosen = roll < 0.55 ? maxIndex : roll < 0.9 ? minIndex : Math.floor(random() * PAIRS.length)
  const [i, j] = PAIRS[chosen]
  return { key: keys[chosen], kept: hand.filter((_, index) => index !== i && index !== j) }
}

export function decidePick(input: BotInput, random: () => number = Math.random): string[] {
  const { hand, level, round } = input
  if (hand.length !== 5) return hand.slice(0, 2).map((card) => card.id)
  const toIds = (pairIndex: number) => PAIRS[pairIndex].map((index) => hand[index].id)

  // 新手：只会凑眼前最大的牌，暗牌回合随手出
  if (level === 'easy') {
    if (!input.publicCard || random() < 0.25) return toIds(Math.floor(random() * PAIRS.length))
    let best = 0
    const keys = PAIRS.map(([i, j]) => keyOf(hand[i], hand[j], input.publicCard as Card))
    keys.forEach((key, index) => { if (key > keys[best]) best = index })
    return toIds(best)
  }

  const known = new Set([...hand, ...input.seen, ...(input.peekHands ?? []).flat()].map((card) => card.id))
  const unseen = createDeck().filter((card) => !known.has(card.id))
  const sims = Math.max(12, Math.round(SIMS[level] * simScale))
  const score = ROUND_SCORES[round - 1]
  const isLastPick = round === HIDDEN_ROUND
  const finalScore = ROUND_SCORES[ROUND_SCORES.length - 1]
  const roundSum = new Array<number>(PAIRS.length).fill(0)
  const finalSum = new Array<number>(PAIRS.length).fill(0)
  const keptHands = PAIRS.map(([i, j]) => hand.filter((_, index) => index !== i && index !== j))
  const finalKeys = isLastPick ? keptHands.map((kept) => keyOf(kept[0], kept[1], kept[2])) : []
  const fixedKeys = input.publicCard
    ? PAIRS.map(([i, j]) => keyOf(hand[i], hand[j], input.publicCard as Card))
    : null

  for (let sim = 0; sim < sims; sim += 1) {
    const pool = shuffle(unseen, random)
    const publicCard = input.publicCard ?? (pool.pop() as Card)
    const opponents: Card[][] = (input.peekHands ?? []).filter((cards) => cards.length === 5).slice(0, 2)
    while (opponents.length < 2) opponents.push(pool.splice(-5, 5))
    const [o1, o2] = opponents.map((cards) => opponentPlay(cards, publicCard, random))
    const myKeys = fixedKeys ?? PAIRS.map(([i, j]) => keyOf(hand[i], hand[j], publicCard))
    const f1 = isLastPick ? keyOf(o1.kept[0], o1.kept[1], o1.kept[2]) : 0
    const f2 = isLastPick ? keyOf(o2.kept[0], o2.kept[1], o2.kept[2]) : 0
    for (let p = 0; p < PAIRS.length; p += 1) {
      roundSum[p] += outcome(myKeys[p], o1.key, o2.key)
      if (isLastPick) finalSum[p] += outcome(finalKeys[p], f1, f2)
    }
  }

  const nextScore = ROUND_SCORES[round] ?? 0
  const futureWeight = level === 'normal' ? 0.5 : 1
  let best = 0
  let bestValue = -Infinity
  for (let p = 0; p < PAIRS.length; p += 1) {
    let value = (roundSum[p] / sims) * score
    if (isLastPick) value += (finalSum[p] / sims) * finalScore * futureWeight
    else value += keepValue(keptHands[p]) * nextScore * 0.5 * futureWeight
    if (level === 'normal') value += (random() - 0.5) * 0.6 * score
    if (value > bestValue) {
      bestValue = value
      best = p
    }
  }
  return toIds(best)
}

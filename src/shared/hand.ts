// 炸金花三张牌型判定与比较。
// 牌型从大到小：豹子 > 同花顺 > 同花 > 顺子 > 对子 > 散牌。
// 大小王为赖子：自动替换为能组成"最大牌型"的任意一张牌。
import { Card, SUITS, isJoker, makeCard, rankStrength, rankText } from './cards.ts'

export type HandType = 'leopard' | 'straight_flush' | 'flush' | 'straight' | 'pair' | 'high_card'

export const HAND_WEIGHT: Record<HandType, number> = {
  leopard: 6,
  straight_flush: 5,
  flush: 4,
  straight: 3,
  pair: 2,
  high_card: 1,
}

export const HAND_NAME: Record<HandType, string> = {
  leopard: '豹子',
  straight_flush: '同花顺',
  flush: '同花',
  straight: '顺子',
  pair: '对子',
  high_card: '散牌',
}

export interface ResolvedCard extends Card {
  /** 该牌由赖子变化而来 */
  wild?: boolean
}

export interface HandEval {
  type: HandType
  weight: number
  /** 可直接比较大小的数值：越大牌越大；相等即平手 */
  key: number
  /** 赖子替换后的三张牌（按展示顺序） */
  cards: ResolvedCard[]
}

const BASE = 15

function encode(weight: number, a: number, b = 0, c = 0): number {
  return ((weight * BASE + a) * BASE + b) * BASE + c
}

/** 顺子的最大点：A23 最小（3），QKA 最大（14）；不是顺子返回 0 */
function straightHigh(ranks: number[]): number {
  const [a, b, c] = [...ranks].sort((x, y) => x - y)
  if (a === 1 && b === 12 && c === 13) return 14
  if (b - a === 1 && c - b === 1) return c
  return 0
}

/** 不含赖子的三张牌判定 */
export function evaluateNatural(cards: ResolvedCard[]): HandEval {
  if (cards.length !== 3) throw new Error('必须是 3 张牌')
  const sorted = [...cards].sort((x, y) => rankStrength(y.rank) - rankStrength(x.rank))
  const ranks = sorted.map((card) => card.rank)
  const strengths = ranks.map(rankStrength)
  const sameSuit = sorted.every((card) => card.suit === sorted[0].suit)
  const high = straightHigh(ranks)

  const build = (type: HandType, a: number, b = 0, c = 0): HandEval => ({
    type,
    weight: HAND_WEIGHT[type],
    key: encode(HAND_WEIGHT[type], a, b, c),
    cards: high === 3 ? [...sorted.slice(1), sorted[0]] : sorted, // A23 把 A 放最后
  })

  if (ranks[0] === ranks[1] && ranks[1] === ranks[2]) return build('leopard', strengths[0])
  if (sameSuit && high) return build('straight_flush', high)
  if (sameSuit) return build('flush', strengths[0], strengths[1], strengths[2])
  if (high) return build('straight', high)
  if (ranks[0] === ranks[1] || ranks[1] === ranks[2]) {
    const pair = strengths[1]
    const kicker = strengths[0] === pair ? strengths[2] : strengths[0]
    return build('pair', pair, kicker)
  }
  return build('high_card', strengths[0], strengths[1], strengths[2])
}

const REPLACEMENTS: Card[] = SUITS.flatMap((suit) =>
  Array.from({ length: 13 }, (_, index) => makeCard(suit, index + 1)),
)

const cache = new Map<string, HandEval>()
const CACHE_LIMIT = 80000

/** 三张牌判定（含赖子自动取最大牌型） */
export function evaluateHand(cards: Card[]): HandEval {
  if (cards.length !== 3) throw new Error('必须是 3 张牌')
  const cacheKey = cards.map((card) => card.id).sort().join('|')
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const naturals: ResolvedCard[] = cards.filter((card) => !isJoker(card))
  const wildCount = 3 - naturals.length
  let best: HandEval | null = null
  let bestDuplicates = Infinity

  if (wildCount === 0) {
    best = evaluateNatural(naturals)
  } else {
    const usedIds = new Set(naturals.map((card) => card.id))
    const picked: ResolvedCard[] = []
    const search = (depth: number) => {
      if (depth === wildCount) {
        const candidate = evaluateNatural([...naturals, ...picked])
        // 同等大小时，优先选不与已有牌重复的替换牌，展示更自然
        const ids = new Set(usedIds)
        let duplicates = 0
        for (const card of picked) {
          if (ids.has(card.id)) duplicates += 1
          ids.add(card.id)
        }
        if (!best || candidate.key > best.key || (candidate.key === best.key && duplicates < bestDuplicates)) {
          best = candidate
          bestDuplicates = duplicates
        }
        return
      }
      for (const replacement of REPLACEMENTS) {
        picked.push({ ...replacement, wild: true })
        search(depth + 1)
        picked.pop()
      }
    }
    search(0)
  }

  const result = best as unknown as HandEval
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(cacheKey, result)
  return result
}

/** >0 表示 a 大；<0 表示 b 大；0 平手 */
export function compareHands(a: HandEval, b: HandEval): number {
  return a.key - b.key
}

/** 牌型的简短文字描述，例如"豹子 A"、"对子 K"、"顺子 QKA" */
export function describeHand(evaluation: HandEval): string {
  const name = HAND_NAME[evaluation.type]
  const cards = evaluation.cards
  switch (evaluation.type) {
    case 'leopard':
      return `${name} ${rankText(cards[0].rank)}`
    case 'pair': {
      const pairRank = cards[0].rank === cards[1].rank ? cards[0].rank : cards[1].rank
      return `${name} ${rankText(pairRank)}`
    }
    case 'straight':
    case 'straight_flush':
      return `${name} ${[...cards].reverse().map((card) => rankText(card.rank)).join('')}`
    default:
      return `${name} ${rankText(cards[0].rank)}大`
  }
}

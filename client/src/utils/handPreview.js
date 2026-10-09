// 牌型预览（仅用于界面展示）：逐字移植自 server/src/domain/gameEngine.js 的牌型判断，含大小王赖子推导。
// 最终结算永远以服务端为准；server/tests/handPreviewParity.test.js 会校验两边结果一致。

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs']
const RANKS = { ACE: 1, KING: 13, JOKER_SMALL: 14, JOKER_BIG: 15 }
const HAND_TYPES = {
  LEOPARD: 'leopard',
  STRAIGHT_FLUSH: 'straight_flush',
  FLUSH: 'flush',
  STRAIGHT: 'straight',
  PAIR: 'pair',
  HIGH_CARD: 'high_card',
}
const HAND_TYPE_WEIGHTS = {
  [HAND_TYPES.LEOPARD]: 6,
  [HAND_TYPES.STRAIGHT_FLUSH]: 5,
  [HAND_TYPES.FLUSH]: 4,
  [HAND_TYPES.STRAIGHT]: 3,
  [HAND_TYPES.PAIR]: 2,
  [HAND_TYPES.HIGH_CARD]: 1,
}
const EVALUATION_CACHE_MAX_SIZE = 20000
const evaluationCache = new Map()
const WILDCARD_REPLACEMENT_CARDS = SUITS.flatMap((suit) => (
  Array.from({ length: 13 }, (_, index) => ({ suit, rank: index + 1 }))
))

function compareRanks(rank1, rank2) {
  let normalizedRank1 = rank1
  let normalizedRank2 = rank2

  if (normalizedRank1 >= RANKS.JOKER_SMALL) normalizedRank1 += 100
  if (normalizedRank2 >= RANKS.JOKER_SMALL) normalizedRank2 += 100
  if (normalizedRank1 === RANKS.ACE) normalizedRank1 = 14
  if (normalizedRank2 === RANKS.ACE) normalizedRank2 = 14

  return normalizedRank1 - normalizedRank2
}

function sortCardsByStrength(cards) {
  return [...cards].sort((cardA, cardB) => compareRanks(cardB.rank, cardA.rank))
}

function compareRankVectors(vector1 = [], vector2 = []) {
  const length = Math.min(vector1.length, vector2.length)
  for (let index = 0; index < length; index += 1) {
    if (vector1[index] !== vector2[index]) {
      return compareRanks(vector1[index], vector2[index])
    }
  }

  return 0
}

function isLeopard(cards) {
  return cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank
}

function isFlush(cards) {
  const normalCards = cards.filter((card) => card.suit !== null)
  if (normalCards.length < 3) {
    return false
  }

  return normalCards.every((card) => card.suit === normalCards[0].suit)
}

function isStraight(cards) {
  const normalCards = cards.filter((card) => card.suit !== null)
  if (normalCards.length < 3) {
    return false
  }

  const ranks = normalCards.map((card) => card.rank).sort((a, b) => a - b)
  if (ranks[2] - ranks[0] === 2 && ranks[1] - ranks[0] === 1) {
    return true
  }

  return (
    (ranks[0] === 1 && ranks[1] === 2 && ranks[2] === 3) ||
    (ranks[0] === 1 && ranks[1] === 12 && ranks[2] === 13)
  )
}

function getHighCardForStraight(cards) {
  const ranks = cards.filter((card) => card.suit !== null).map((card) => card.rank).sort((a, b) => a - b)
  if (ranks[0] === 1 && ranks[1] === 2 && ranks[2] === 3) return 3
  if (ranks[0] === 1 && ranks[1] === 12 && ranks[2] === 13) return 14
  return Math.max(...ranks)
}

function isPair(cards) {
  const ranks = cards.map((card) => card.rank)
  return ranks[0] === ranks[1] || ranks[1] === ranks[2] || ranks[0] === ranks[2]
}

function getPairRank(cards) {
  const ranks = cards.map((card) => card.rank)
  if (ranks[0] === ranks[1]) return ranks[0]
  if (ranks[1] === ranks[2]) return ranks[1]
  if (ranks[0] === ranks[2]) return ranks[0]
  return null
}

function isWildcardCard(card) {
  return Number(card?.rank) >= RANKS.JOKER_SMALL
}

function getCardCacheKey(card = {}) {
  return `${card.suit || 'joker'}:${card.rank}`
}

function getEvaluationCacheKey(cards = []) {
  return cards.map((card) => getCardCacheKey(card)).sort().join('|')
}

function evaluateNaturalHand(cards) {
  if (cards.length !== 3) {
    throw new Error('炸金花必须是3张牌')
  }

  const sortedCards = sortCardsByStrength(cards)
  const rankVector = sortedCards.map((card) => card.rank)
  if (isLeopard(sortedCards)) {
    return { type: HAND_TYPES.LEOPARD, weight: HAND_TYPE_WEIGHTS[HAND_TYPES.LEOPARD], highCard: sortedCards[0].rank, cards: sortedCards }
  }
  if (isFlush(sortedCards) && isStraight(sortedCards)) {
    return { type: HAND_TYPES.STRAIGHT_FLUSH, weight: HAND_TYPE_WEIGHTS[HAND_TYPES.STRAIGHT_FLUSH], highCard: getHighCardForStraight(sortedCards), cards: sortedCards }
  }
  if (isFlush(sortedCards)) {
    return { type: HAND_TYPES.FLUSH, weight: HAND_TYPE_WEIGHTS[HAND_TYPES.FLUSH], highCard: sortedCards[0].rank, rankVector, cards: sortedCards }
  }
  if (isStraight(sortedCards)) {
    return { type: HAND_TYPES.STRAIGHT, weight: HAND_TYPE_WEIGHTS[HAND_TYPES.STRAIGHT], highCard: getHighCardForStraight(sortedCards), cards: sortedCards }
  }
  if (isPair(sortedCards)) {
    const pairRank = getPairRank(sortedCards)
    const kicker = sortedCards.find((card) => card.rank !== pairRank).rank
    return { type: HAND_TYPES.PAIR, weight: HAND_TYPE_WEIGHTS[HAND_TYPES.PAIR], highCard: pairRank, kicker, cards: sortedCards }
  }
  return { type: HAND_TYPES.HIGH_CARD, weight: HAND_TYPE_WEIGHTS[HAND_TYPES.HIGH_CARD], highCard: sortedCards[0].rank, rankVector, cards: sortedCards }
}

function pickBestWildcardEvaluation(baseCards, wildcardCount) {
  let bestEvaluation = null
  const pickedCards = []

  const search = (depth) => {
    if (depth >= wildcardCount) {
      const candidateEvaluation = evaluateNaturalHand([...baseCards, ...pickedCards])
      if (!bestEvaluation || compareHands(candidateEvaluation, bestEvaluation) > 0) {
        bestEvaluation = candidateEvaluation
      }
      return
    }

    WILDCARD_REPLACEMENT_CARDS.forEach((replacementCard) => {
      pickedCards.push(replacementCard)
      search(depth + 1)
      pickedCards.pop()
    })
  }

  search(0)
  return bestEvaluation
}

function evaluateHand(cards) {
  if (cards.length !== 3) {
    throw new Error('炸金花必须是3张牌')
  }

  const cacheKey = getEvaluationCacheKey(cards)
  const cachedEvaluation = evaluationCache.get(cacheKey)
  if (cachedEvaluation) {
    return cachedEvaluation
  }

  const wildcardCount = cards.filter((card) => isWildcardCard(card)).length
  const evaluation = wildcardCount > 0
    ? pickBestWildcardEvaluation(
      cards.filter((card) => !isWildcardCard(card)),
      wildcardCount,
    )
    : evaluateNaturalHand(cards)

  if (!evaluation) {
    throw new Error('牌型评估失败')
  }

  if (evaluationCache.size >= EVALUATION_CACHE_MAX_SIZE) {
    evaluationCache.clear()
  }
  evaluationCache.set(cacheKey, evaluation)
  return evaluation
}

function compareHands(hand1, hand2) {
  if (hand1.weight !== hand2.weight) {
    return hand1.weight - hand2.weight
  }
  if (hand1.highCard !== hand2.highCard) {
    return compareRanks(hand1.highCard, hand2.highCard)
  }
  if (hand1.type === HAND_TYPES.PAIR && hand1.kicker !== hand2.kicker) {
    return compareRanks(hand1.kicker, hand2.kicker)
  }
  if (
    (hand1.type === HAND_TYPES.HIGH_CARD || hand1.type === HAND_TYPES.FLUSH)
    && hand1.rankVector
    && hand2.rankVector
  ) {
    return compareRankVectors(hand1.rankVector, hand2.rankVector)
  }
  return 0
}


const HAND_TYPE_NAMES = {
  leopard: '豹子',
  straight_flush: '同花顺',
  flush: '同花',
  straight: '顺子',
  pair: '对子',
  high_card: '单张',
}
const RANK_LABELS = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }

function rankLabel(rank) {
  return RANK_LABELS[rank] || String(rank)
}

// 例如“同花 · A 高”“对子 · 8”“豹子 · K”
export function describeHand(evaluation) {
  if (!evaluation) {
    return ''
  }
  const name = HAND_TYPE_NAMES[evaluation.type] || ''
  if (evaluation.type === 'pair' || evaluation.type === 'leopard') {
    return `${name} · ${rankLabel(evaluation.highCard)}`
  }
  return `${name} · ${rankLabel(evaluation.highCard)} 高`
}

export function previewHand(cards) {
  if (!Array.isArray(cards) || cards.length !== 3 || cards.some((card) => !card)) {
    return null
  }
  const evaluation = evaluateHand(cards)
  return { evaluation, text: describeHand(evaluation), usesWildcard: cards.some(isWildcardCard) }
}

export { evaluateHand, compareHands, HAND_TYPE_NAMES }

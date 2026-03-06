import { HAND_TYPES, HAND_TYPE_WEIGHTS, RANKS } from './cards.js'

// 判断牌型
export function evaluateHand(cards) {
  if (cards.length !== 3) {
    throw new Error('炸金花必须是3张牌')
  }

  const sortedCards = sortCardsByStrength(cards)
  const rankVector = sortedCards.map((card) => card.rank)
  
  // 检查豹子（三张相同）
  if (isLeopard(sortedCards)) {
    return {
      type: HAND_TYPES.LEOPARD,
      weight: HAND_TYPE_WEIGHTS[HAND_TYPES.LEOPARD],
      highCard: sortedCards[0].rank,
      cards: sortedCards
    }
  }
  
  // 检查同花顺
  if (isStraightFlush(sortedCards)) {
    return {
      type: HAND_TYPES.STRAIGHT_FLUSH,
      weight: HAND_TYPE_WEIGHTS[HAND_TYPES.STRAIGHT_FLUSH],
      highCard: getHighCardForStraight(sortedCards),
      cards: sortedCards
    }
  }
  
  // 检查同花
  if (isFlush(sortedCards)) {
    return {
      type: HAND_TYPES.FLUSH,
      weight: HAND_TYPE_WEIGHTS[HAND_TYPES.FLUSH],
      highCard: sortedCards[0].rank,
      rankVector,
      cards: sortedCards
    }
  }
  
  // 检查顺子
  if (isStraight(sortedCards)) {
    return {
      type: HAND_TYPES.STRAIGHT,
      weight: HAND_TYPE_WEIGHTS[HAND_TYPES.STRAIGHT],
      highCard: getHighCardForStraight(sortedCards),
      cards: sortedCards
    }
  }
  
  // 检查对子
  if (isPair(sortedCards)) {
    const pairRank = getPairRank(sortedCards)
    const kicker = sortedCards.find(card => card.rank !== pairRank).rank
    return {
      type: HAND_TYPES.PAIR,
      weight: HAND_TYPE_WEIGHTS[HAND_TYPES.PAIR],
      highCard: pairRank,
      kicker: kicker,
      cards: sortedCards
    }
  }
  
  // 单张
  return {
    type: HAND_TYPES.HIGH_CARD,
    weight: HAND_TYPE_WEIGHTS[HAND_TYPES.HIGH_CARD],
    highCard: sortedCards[0].rank,
    rankVector,
    cards: sortedCards
  }
}

// 比较两手牌的大小
export function compareHands(hand1, hand2) {
  // 先比较牌型权重
  if (hand1.weight !== hand2.weight) {
    return hand1.weight - hand2.weight
  }
  
  // 牌型相同，比较高牌
  if (hand1.highCard !== hand2.highCard) {
    return compareRanks(hand1.highCard, hand2.highCard)
  }
  
  // 对子的情况，还要比较踢脚牌
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
  
  // 完全相同
  return 0
}

// 比较牌面大小（处理A的特殊情况）
function compareRanks(rank1, rank2) {
  // 大小王最大
  if (rank1 >= RANKS.JOKER_SMALL) rank1 += 100
  if (rank2 >= RANKS.JOKER_SMALL) rank2 += 100
  
  // A在顺子中可能是1或14
  if (rank1 === RANKS.ACE) rank1 = 14
  if (rank2 === RANKS.ACE) rank2 = 14
  
  return rank1 - rank2
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

// 检查是否为豹子
function isLeopard(cards) {
  return cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank
}

// 检查是否为同花顺
function isStraightFlush(cards) {
  return isFlush(cards) && isStraight(cards)
}

// 检查是否为同花
function isFlush(cards) {
  // 王牌不参与同花判断
  const normalCards = cards.filter(card => card.suit !== null)
  if (normalCards.length < 3) return false
  
  return normalCards.every(card => card.suit === normalCards[0].suit)
}

// 检查是否为顺子
function isStraight(cards) {
  // 王牌不参与顺子判断
  const normalCards = cards.filter(card => card.suit !== null)
  if (normalCards.length < 3) return false
  
  const ranks = normalCards.map(card => card.rank).sort((a, b) => a - b)
  
  // 检查连续性
  if (ranks[2] - ranks[0] === 2 && ranks[1] - ranks[0] === 1) {
    return true
  }
  
  // 检查A-2-3的特殊情况
  if (ranks[0] === 1 && ranks[1] === 2 && ranks[2] === 3) {
    return true
  }
  
  // 检查Q-K-A的特殊情况
  if (ranks[0] === 1 && ranks[1] === 12 && ranks[2] === 13) {
    return true
  }
  
  return false
}

// 检查是否为对子
function isPair(cards) {
  const ranks = cards.map(card => card.rank)
  return ranks[0] === ranks[1] || ranks[1] === ranks[2] || ranks[0] === ranks[2]
}

// 获取对子的牌面值
function getPairRank(cards) {
  const ranks = cards.map(card => card.rank)
  if (ranks[0] === ranks[1]) return ranks[0]
  if (ranks[1] === ranks[2]) return ranks[1]
  if (ranks[0] === ranks[2]) return ranks[0]
  return null
}

// 获取顺子的高牌
function getHighCardForStraight(cards) {
  const normalCards = cards.filter(card => card.suit !== null)
  const ranks = normalCards.map(card => card.rank).sort((a, b) => a - b)
  
  // A-2-3的情况，A作为1，高牌是3
  if (ranks[0] === 1 && ranks[1] === 2 && ranks[2] === 3) {
    return 3
  }
  
  // Q-K-A的情况，A作为14，高牌是A
  if (ranks[0] === 1 && ranks[1] === 12 && ranks[2] === 13) {
    return 14
  }
  
  // 普通顺子，返回最大牌
  return Math.max(...ranks)
}

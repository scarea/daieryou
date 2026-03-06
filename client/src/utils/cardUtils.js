// 从共享模块导入卡牌相关功能
import { 
  SUITS, 
  RANKS, 
  HAND_TYPES, 
  createDeck, 
  shuffleDeck, 
  getCardName 
} from '../../../shared/game-rules/cards.js'

import { 
  evaluateHand, 
  compareHands 
} from '../../../shared/game-rules/hand-evaluator.js'

// 重新导出供前端使用
export {
  SUITS,
  RANKS,
  HAND_TYPES,
  createDeck,
  shuffleDeck,
  getCardName,
  evaluateHand,
  compareHands
}

// 前端特有的工具函数

// 获取牌的颜色（红色或黑色）
export function getCardColor(card) {
  if (card.rank >= RANKS.JOKER_SMALL) {
    return 'joker'
  }
  
  if (card.suit === SUITS.HEARTS || card.suit === SUITS.DIAMONDS) {
    return 'red'
  }
  
  return 'black'
}

// 获取牌的CSS类名
export function getCardClassName(card) {
  const color = getCardColor(card)
  return `card card-${color}`
}

// 格式化牌型名称
export function getHandTypeName(handType) {
  const names = {
    [HAND_TYPES.LEOPARD]: '豹子',
    [HAND_TYPES.STRAIGHT_FLUSH]: '同花顺',
    [HAND_TYPES.FLUSH]: '同花',
    [HAND_TYPES.STRAIGHT]: '顺子',
    [HAND_TYPES.PAIR]: '对子',
    [HAND_TYPES.HIGH_CARD]: '单张'
  }
  
  return names[handType] || '未知'
}

// 比较三手牌，返回排序结果（第一名、第二名、第三名）
export function rankThreeHands(hands) {
  if (hands.length !== 3) {
    throw new Error('必须是3手牌')
  }
  
  // 评估每手牌
  const evaluatedHands = hands.map((cards, index) => ({
    index,
    cards,
    evaluation: evaluateHand(cards)
  }))
  
  // 排序（从大到小）
  evaluatedHands.sort((a, b) => compareHands(b.evaluation, a.evaluation))
  
  return {
    first: evaluatedHands[0],   // 第一名
    second: evaluatedHands[1],  // 第二名（输家）
    third: evaluatedHands[2]    // 第三名
  }
}

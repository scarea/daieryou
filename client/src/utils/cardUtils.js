// 牌型判断（含大小王赖子）只在服务端进行，前端只负责展示
import { SUITS, RANKS, HAND_TYPES, getCardName } from './cards.js'

export { SUITS, RANKS, HAND_TYPES, getCardName }

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

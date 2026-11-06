// 扑克牌相关常量和工具函数

// 花色定义
export const SUITS = {
  SPADES: 'spades',     // 黑桃
  HEARTS: 'hearts',     // 红桃
  DIAMONDS: 'diamonds', // 方块
  CLUBS: 'clubs'        // 梅花
}

// 牌面值定义
export const RANKS = {
  ACE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  SEVEN: 7,
  EIGHT: 8,
  NINE: 9,
  TEN: 10,
  JACK: 11,
  QUEEN: 12,
  KING: 13,
  JOKER_SMALL: 14,  // 小王
  JOKER_BIG: 15     // 大王
}

// 牌型定义
export const HAND_TYPES = {
  LEOPARD: 'leopard',           // 豹子（三张相同）
  STRAIGHT_FLUSH: 'straight_flush', // 同花顺
  FLUSH: 'flush',               // 同花
  STRAIGHT: 'straight',         // 顺子
  PAIR: 'pair',                 // 对子
  HIGH_CARD: 'high_card'        // 单张
}

// 牌型权重（用于比较大小）
export const HAND_TYPE_WEIGHTS = {
  [HAND_TYPES.LEOPARD]: 6,
  [HAND_TYPES.STRAIGHT_FLUSH]: 5,
  [HAND_TYPES.FLUSH]: 4,
  [HAND_TYPES.STRAIGHT]: 3,
  [HAND_TYPES.PAIR]: 2,
  [HAND_TYPES.HIGH_CARD]: 1
}

// 创建一副完整的牌
export function createDeck() {
  const deck = []
  
  // 添加普通牌 A-K
  Object.values(SUITS).forEach(suit => {
    for (let rank = RANKS.ACE; rank <= RANKS.KING; rank++) {
      deck.push({ suit, rank })
    }
  })
  
  // 添加大小王
  deck.push({ suit: null, rank: RANKS.JOKER_SMALL })
  deck.push({ suit: null, rank: RANKS.JOKER_BIG })
  
  return deck
}

// 洗牌
export function shuffleDeck(deck) {
  const shuffled = [...deck]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

// 获取牌的显示名称
export function getCardName(card) {
  if (card.rank === RANKS.JOKER_SMALL) return '小王'
  if (card.rank === RANKS.JOKER_BIG) return '大王'
  
  const suitNames = {
    [SUITS.SPADES]: '♠',
    [SUITS.HEARTS]: '♥',
    [SUITS.DIAMONDS]: '♦',
    [SUITS.CLUBS]: '♣'
  }
  
  const rankNames = {
    1: 'A', 11: 'J', 12: 'Q', 13: 'K'
  }
  
  const suitName = suitNames[card.suit]
  const rankName = rankNames[card.rank] || card.rank.toString()
  
  return `${suitName}${rankName}`
}

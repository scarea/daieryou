// 扑克牌基础定义：54 张牌（A-K 四花色 + 大小王），大小王为赖子。

export type Suit = 'S' | 'H' | 'D' | 'C'

export interface Card {
  /** 唯一标识，例如 S1（黑桃A）、H13（红桃K）、JS（小王）、JB（大王） */
  id: string
  /** 花色；大小王为 null */
  suit: Suit | null
  /** 1=A … 13=K，14=小王，15=大王 */
  rank: number
}

export const SUITS: Suit[] = ['S', 'H', 'D', 'C']
export const RANK_JOKER_SMALL = 14
export const RANK_JOKER_BIG = 15

export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
export const SUIT_NAME: Record<Suit, string> = { S: '黑桃', H: '红桃', D: '方块', C: '梅花' }

const RANK_TEXT = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export function makeCard(suit: Suit | null, rank: number): Card {
  if (rank === RANK_JOKER_SMALL) return { id: 'JS', suit: null, rank }
  if (rank === RANK_JOKER_BIG) return { id: 'JB', suit: null, rank }
  return { id: `${suit}${rank}`, suit, rank }
}

export function isJoker(card: Pick<Card, 'rank'>): boolean {
  return card.rank >= RANK_JOKER_SMALL
}

export function isRedSuit(suit: Suit | null): boolean {
  return suit === 'H' || suit === 'D'
}

export function rankText(rank: number): string {
  if (rank === RANK_JOKER_SMALL) return '小王'
  if (rank === RANK_JOKER_BIG) return '大王'
  return RANK_TEXT[rank] ?? '?'
}

export function cardText(card: Card): string {
  if (isJoker(card)) return rankText(card.rank)
  return `${SUIT_SYMBOL[card.suit as Suit]}${rankText(card.rank)}`
}

export function createDeck(): Card[] {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank += 1) deck.push(makeCard(suit, rank))
  }
  deck.push(makeCard(null, RANK_JOKER_SMALL))
  deck.push(makeCard(null, RANK_JOKER_BIG))
  return deck
}

/** Fisher–Yates 洗牌；可注入随机源以便测试复现 */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

/** 点数强度：A 最大（14），其余按点数 */
export function rankStrength(rank: number): number {
  return rank === 1 ? 14 : rank
}

/** 手牌整理：赖子在前，其余按点数从大到小、花色次序 */
export function sortHand(cards: Card[]): Card[] {
  const suitOrder: Record<string, number> = { S: 0, H: 1, C: 2, D: 3 }
  return [...cards].sort((a, b) => {
    const ja = isJoker(a) ? 1 : 0
    const jb = isJoker(b) ? 1 : 0
    if (ja !== jb) return jb - ja
    if (ja && jb) return b.rank - a.rank
    const diff = rankStrength(b.rank) - rankStrength(a.rank)
    if (diff !== 0) return diff
    return suitOrder[a.suit as string] - suitOrder[b.suit as string]
  })
}

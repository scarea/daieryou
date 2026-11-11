import { Card, Suit, makeCard } from '../src/shared/cards.ts'

/** 用简写构造牌：'SA' 黑桃A、'H10'、'DK'、'JS' 小王、'JB' 大王 */
export function c(text: string): Card {
  if (text === 'JS') return makeCard(null, 14)
  if (text === 'JB') return makeCard(null, 15)
  const map: Record<string, number> = { A: 1, J: 11, Q: 12, K: 13 }
  const value = text.slice(1)
  return makeCard(text[0] as Suit, map[value] ?? Number(value))
}

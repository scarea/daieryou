// 扑克牌：象牙牌面 + 鎏金描边，背面为朱漆金格纹。
import { memo } from 'react'
import { Card, SUIT_SYMBOL, Suit, isJoker, isRedSuit, rankText } from '../../shared/cards.ts'
import type { ResolvedCard } from '../../shared/hand.ts'

interface Props {
  card?: Card | null
  faceUp?: boolean
  /** 赖子在亮牌时变成的牌 */
  wildAs?: ResolvedCard | null
  /** 右上角小标记，如"公" */
  tag?: string
}

function Face({ card, wildAs, tag }: { card: Card; wildAs?: ResolvedCard | null; tag?: string }) {
  if (isJoker(card)) {
    const big = card.rank === 15
    return (
      <div className={`card-face joker ${big ? 'joker-big' : 'joker-small'}`}>
        <div className="joker-side">JOKER</div>
        <div className="joker-center">
          <span className="joker-glyph">王</span>
          <span className="joker-name">{big ? '大王' : '小王'}</span>
        </div>
        <div className="joker-ribbon">赖子</div>
        {wildAs && (
          <div className={`wild-as ${isRedSuit(wildAs.suit) ? 'red' : 'black'}`}>
            变 {SUIT_SYMBOL[wildAs.suit as Suit]}{rankText(wildAs.rank)}
          </div>
        )}
      </div>
    )
  }
  const suit = SUIT_SYMBOL[card.suit as Suit]
  const rank = rankText(card.rank)
  const court = card.rank >= 11
  return (
    <div className={`card-face ${isRedSuit(card.suit) ? 'red' : 'black'}`}>
      <div className="corner tl">
        <span className="corner-rank">{rank}</span>
        <span className="corner-suit">{suit}</span>
      </div>
      <div className="corner br">
        <span className="corner-rank">{rank}</span>
        <span className="corner-suit">{suit}</span>
      </div>
      {court ? (
        <div className="court">
          <span className="court-crown">{card.rank === 13 ? '♚' : card.rank === 12 ? '♛' : '♞'}</span>
          <span className="court-letter">{rank}</span>
          <span className="court-suit">{suit}</span>
        </div>
      ) : (
        <div className={`pip ${card.rank === 1 ? 'pip-ace' : ''}`}>{suit}</div>
      )}
      {tag && <div className="card-tag">{tag}</div>}
    </div>
  )
}

export const CardView = memo(function CardView({ card, faceUp = true, wildAs, tag }: Props) {
  const showFace = Boolean(card) && faceUp
  return (
    <div className={`card3d ${showFace ? 'is-face' : 'is-back'}`}>
      <div className="card-side card-front">{card && <Face card={card} wildAs={wildAs} tag={tag} />}</div>
      <div className="card-side card-back">
        <div className="back-pattern" />
        <div className="back-medal">逮</div>
      </div>
    </div>
  )
})

import React from 'react'
import Card from './Card'

const HandCards = ({
  cards,
  selectedIndices = [],
  animatingIndices = [],
  onCardSelect,
  disabled = false,
  cardSize = 'lg',
}) => {
  const handleCardClick = (card, index) => {
    if (disabled || !onCardSelect) return

    onCardSelect(index)
  }

  return (
    <div className="hand-cards-grid" role="list" aria-label="你的手牌列表">
      {cards.map((card, index) => (
        <div
          key={index}
          role="listitem"
          className={`hand-card-shell ${animatingIndices.includes(index) ? 'is-playing' : ''}`}
        >
          <Card
            card={card}
            selected={selectedIndices.includes(index)}
            onClick={() => handleCardClick(card, index)}
            disabled={disabled || animatingIndices.includes(index)}
            size={cardSize}
            reveal
            ariaLabel={`第 ${index + 1} 张手牌`}
            testId={`hand-card-${index}`}
          />
        </div>
      ))}
    </div>
  )
}

export default HandCards

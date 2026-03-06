import React from 'react'
import Card from './Card'

const HandCards = ({ cards, selectedIndices = [], onCardSelect, disabled = false }) => {
  const handleCardClick = (card, index) => {
    if (disabled || !onCardSelect) return

    onCardSelect(index)
  }

  return (
    <div className="hand-cards-grid" role="list" aria-label="你的手牌列表">
      {cards.map((card, index) => (
        <div key={index} role="listitem">
          <Card
            card={card}
            selected={selectedIndices.includes(index)}
            onClick={() => handleCardClick(card, index)}
            disabled={disabled}
            size="lg"
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

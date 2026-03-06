import React from 'react'
import { getCardName, getCardColor } from '../utils/cardUtils'
import './Card.css'

const Card = ({
  card,
  selected = false,
  onClick,
  disabled = false,
  testId,
  size = 'md',
  reveal = false,
  ariaLabel,
}) => {
  const interactive = typeof onClick === 'function' && !disabled

  const activate = () => {
    if (!interactive) {
      return
    }
    onClick(card)
  }

  const handleKeyDown = (event) => {
    if (!interactive) {
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  }

  if (!card) {
    return (
      <div
        className={`card card-back card-size-${size} ${reveal ? 'card-reveal' : ''}`}
        data-testid={testId}
        aria-label={ariaLabel || '暗牌'}
        role="img"
      >
        <div className="card-content">?</div>
      </div>
    )
  }

  const cardName = getCardName(card)
  const cardColor = getCardColor(card)
  const label = ariaLabel || `${cardName}，${selected ? '已选中' : '未选中'}`

  return (
    <div
      className={`card card-size-${size} card-${cardColor} ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''} ${reveal ? 'card-reveal' : ''}`}
      data-testid={testId}
      onClick={activate}
      onKeyDown={handleKeyDown}
      role={interactive ? 'button' : 'img'}
      tabIndex={interactive ? 0 : -1}
      aria-label={label}
      aria-pressed={interactive ? selected : undefined}
      aria-disabled={disabled}
    >
      <div className="card-content">
        {cardName}
      </div>
    </div>
  )
}

export default Card

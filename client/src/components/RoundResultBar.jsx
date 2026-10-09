import React, { useEffect, useState } from 'react'
import { Button } from 'antd'
import { getCardName, getHandTypeName } from '../utils/cardUtils'

const RANK_META = {
  1: { label: '头名', className: 'rank-first' },
  2: { label: '次名·二游', className: 'rank-second' },
  3: { label: '末位', className: 'rank-third' },
}

function getLoserIndexes(roundResult) {
  return roundResult.loserIndexes || (roundResult.loserIndex >= 0 ? [roundResult.loserIndex] : [])
}

/**
 * 回合结果条：结算演出结束后出现在顶部，不遮挡牌桌和手牌。
 * autoDismissMs 为空时作为“确认闸门”（例如终局前必须确认第 4 轮）。
 */
const RoundResultBar = ({ roundResult, currentPlayerId, onContinue, autoDismissMs = null, continueText = '继续' }) => {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!autoDismissMs) {
      return undefined
    }
    const timer = window.setTimeout(() => onContinue(), autoDismissMs)
    return () => window.clearTimeout(timer)
  }, [autoDismissMs, onContinue, roundResult])

  if (!roundResult || !Array.isArray(roundResult.playerResults)) {
    return null
  }

  const loserIndexes = getLoserIndexes(roundResult)
  const loserNames = roundResult.playerResults
    .filter((result) => loserIndexes.includes(result.playerIndex))
    .map((result) => result.playerName)
  const selfResult = roundResult.playerResults.find((result) => result.playerId === currentPlayerId)
  const selfDelta = Number(selfResult?.scoreDelta || 0)
  const sorted = [...roundResult.playerResults].sort((left, right) => left.rank - right.rank || left.playerIndex - right.playerIndex)
  const headline = loserNames.length === 0
    ? '本轮平局，无人买单'
    : `${loserNames.join('、')} ${loserNames.length > 1 ? '并列二游' : '成为二游'}`

  const handleContinue = () => {
    setLeaving(true)
    onContinue()
  }

  return (
    <section
      className={`round-result-bar ${leaving ? 'is-leaving' : ''} ${selfResult ? (selfDelta >= 0 ? 'self-win' : 'self-loss') : ''}`.trim()}
      aria-live="polite"
      aria-label={`第 ${roundResult.round} 轮结算`}
    >
      <header className="round-result-bar-head">
        <span className="round-result-bar-round">第 {roundResult.round} 轮</span>
        <strong>{headline}</strong>
        {selfResult && (
          <span className={`round-result-bar-self ${selfDelta >= 0 ? 'gain' : 'loss'}`}>
            {selfDelta >= 0 ? '你安全上岸' : '你被逮了'} {selfDelta > 0 ? '+' : ''}{selfDelta}
          </span>
        )}
      </header>

      <div className="round-result-bar-players">
        {sorted.map((result) => {
          const isLoser = loserIndexes.includes(result.playerIndex)
          const meta = isLoser ? RANK_META[2] : RANK_META[result.rank] || RANK_META[3]
          const delta = Number(result.scoreDelta || 0)
          return (
            <div
              key={result.playerId || result.playerIndex}
              className={`round-result-player-card ${meta.className} ${isLoser ? 'is-loser' : ''} ${result.playerId === currentPlayerId ? 'is-self' : ''}`.trim()}
            >
              <span className="round-result-rank-badge">{isLoser ? '次名·二游' : meta.label}</span>
              <span className="round-result-player-name">{result.playerName}</span>
              <span className="round-result-hand">
                {(result.hand || []).map((card) => getCardName(card)).join(' ')}
                <em>{getHandTypeName(result.evaluation?.type)}</em>
              </span>
              <span className={`score-change-pill ${delta >= 0 ? 'gain' : 'loss'}`}>{delta > 0 ? '+' : ''}{delta}</span>
            </div>
          )
        })}
      </div>

      <div className="round-result-bar-actions">
        <Button type="primary" className="hud-cta" data-testid="round-result-continue" onClick={handleContinue}>
          {continueText}
        </Button>
        {autoDismissMs && <span className="round-result-bar-timer" style={{ animationDuration: `${autoDismissMs}ms` }} />}
      </div>
    </section>
  )
}

export default RoundResultBar

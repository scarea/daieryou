import React, { useEffect, useState } from 'react'
import { Card, Typography, Space, Button, Tag, Divider, Modal } from 'antd'
import { TrophyOutlined, MehOutlined, FireOutlined } from '@ant-design/icons'
import CardComponent from './Card'
import { getHandTypeName } from '../utils/cardUtils'

const { Title, Text } = Typography

const rankMetaMap = {
  1: { icon: <TrophyOutlined />, color: '#1e9f63', label: '头名' },
  2: { icon: <MehOutlined />, color: '#d17a29', label: '次名·二游' },
  3: { icon: <FireOutlined />, color: '#a44646', label: '末位' },
}

const RoundResult = ({
  roundResult,
  visible,
  onClose,
  currentPlayerId = '',
  currentUsername = '',
}) => {
  const [showScoreAnimation, setShowScoreAnimation] = useState(false)

  useEffect(() => {
    if (!visible) {
      setShowScoreAnimation(false)
      return undefined
    }

    // 缩短延迟从 600ms 到 300ms，提升响应速度
    const timer = window.setTimeout(() => {
      setShowScoreAnimation(true)
    }, 300)

    return () => {
      window.clearTimeout(timer)
    }
  }, [visible])

  if (!roundResult) {
    return null
  }

  const loserIndexes = roundResult.loserIndexes || (roundResult.loserIndex >= 0 ? [roundResult.loserIndex] : [])
  const getScoreDelta = (result = {}) => {
    const isLoser = loserIndexes.includes(result.playerIndex)
    const fallbackScoreDelta = isLoser ? -roundResult.score : roundResult.score
    return Number.isFinite(result.scoreDelta) ? Number(result.scoreDelta) : fallbackScoreDelta
  }

  const isSelfResult = (result = {}) => (
    (currentPlayerId && result.playerId === currentPlayerId)
    || (!result.playerId && currentUsername && result.playerName === currentUsername)
  )

  const selfResult = roundResult.playerResults.find((result) => isSelfResult(result)) || null
  const selfScoreDelta = selfResult ? getScoreDelta(selfResult) : null
  const selfOutcomeLabel = selfScoreDelta == null
    ? ''
    : (selfScoreDelta >= 0 ? '本轮你安全上岸' : '本轮你成为二游')
  const sortedPlayerResults = [...roundResult.playerResults].sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank
    return left.playerIndex - right.playerIndex
  })
  const loserNames = loserIndexes.map((loserIdx) => {
    const loserResult = roundResult.playerResults.find((result) => result.playerIndex === loserIdx)
    return loserResult?.playerName || `玩家${loserIdx + 1}`
  })
  const loserSummaryText = loserNames.length === 0
    ? '本轮无二游输家'
    : loserNames.length === 1
      ? `${loserNames[0]} 成为本轮二游`
      : `${loserNames.join('、')} 并列二游`
  const resultGridClassName = `round-result-grid ${selfResult ? 'has-self-focus' : ''}`.trim()
  const contentClassName = `round-result-content ${selfScoreDelta == null ? '' : selfScoreDelta >= 0 ? 'is-self-win' : 'is-self-loss'}`.trim()

  return (
    <Modal
      title={(
        <div className="round-modal-title">
          <span className="round-title-kicker">ROUND SETTLEMENT</span>
          <Title level={3} className="scene-hero-title">
            第 {roundResult.round} 轮结算
          </Title>
        </div>
      )}
      open={visible}
      onCancel={onClose}
      footer={(
        <Button type="primary" className="scene-primary-btn scene-action-btn" onClick={onClose} size="large" data-testid="round-result-continue">
          进入下一轮
        </Button>
      )}
      width={1040}
      centered
      className="round-result-modal"
    >
      <div className={contentClassName}>
        <div className="round-result-flow-strip" aria-label="本轮结算流程">
          <span className="is-done">翻牌</span>
          <span className="is-done">牌型</span>
          <span className={showScoreAnimation ? 'is-done is-active' : 'is-active'}>积分</span>
        </div>

        <section className="round-settlement-hero">
          <div className={`round-self-banner ${selfScoreDelta == null || selfScoreDelta >= 0 ? 'win' : 'loss'}`}>
            <span className="round-hero-label">你的结果</span>
            <Text strong>{selfOutcomeLabel || '观战结算'}</Text>
            {selfScoreDelta != null && (
              <span className="round-self-score">
                {selfScoreDelta >= 0 ? '+' : ''}{selfScoreDelta}
              </span>
            )}
          </div>

          <div className="round-public-stage">
            <span className="round-hero-label">本轮公牌</span>
            <div className="round-public-card-inner">
              {roundResult.publicCard ? (
                <CardComponent card={roundResult.publicCard} size="lg" reveal />
              ) : (
                <span className="round-no-public-card">终局底牌</span>
              )}
            </div>
          </div>

          <div className="round-loser-callout">
            <span className="round-hero-label">逮二游</span>
            <strong>{loserSummaryText}</strong>
            <em>本轮基础分 {roundResult.score}</em>
          </div>
        </section>

        <div className={resultGridClassName}>
          {sortedPlayerResults.map((result, resultIndex) => {
            const rankMeta = rankMetaMap[result.rank] || rankMetaMap[3]
            const loserIndexes = roundResult.loserIndexes || (roundResult.loserIndex >= 0 ? [roundResult.loserIndex] : [])
            const isLoser = loserIndexes.includes(result.playerIndex)
            const isSelf = isSelfResult(result)
            const scoreDelta = getScoreDelta(result)
            const scoreClassName = scoreDelta < 0 ? 'loss' : 'gain'

            return (
              <Card
                className={`scene-card round-result-player-card rank-${result.rank} ${isLoser ? 'is-loser' : ''} ${isSelf ? 'is-self' : 'is-other'}`.trim()}
                key={`${result.playerIndex}-${result.rank}`}
                size="small"
                style={{ '--reveal-order': resultIndex, '--rank-color': rankMeta.color }}
              >
                <div className="round-result-card-glow" />
                <div className="round-result-rank-badge" style={{ background: rankMeta.color }}>
                  {rankMeta.label}
                </div>

                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <div className="round-result-player-head">
                    <span className="round-rank-icon" style={{ color: rankMeta.color }}>
                      {rankMeta.icon}
                    </span>
                    <Text strong className="round-result-player-name">
                      {result.playerName || `玩家${result.playerIndex + 1}`}
                    </Text>
                    {isSelf && <Tag color="gold">你</Tag>}
                    {result.selectedByTimeout && <Tag color="orange">托管</Tag>}
                  </div>

                  <div className="round-result-hand-cards">
                    {result.hand.map((card, cardIndex) => (
                      <span
                        className="round-reveal-card-shell"
                        key={cardIndex}
                        style={{ '--card-order': cardIndex }}
                      >
                        <CardComponent card={card} size="sm" reveal />
                      </span>
                    ))}
                  </div>

                  <div className="round-result-type-tag">
                    <Tag color={result.rank === 1 ? 'green' : isLoser ? 'red' : 'blue'}>
                      {getHandTypeName(result.evaluation.type)}
                    </Tag>
                  </div>

                  {showScoreAnimation && (
                    <div className={`score-change-pill ${scoreClassName}`}>
                      {scoreDelta >= 0 ? '+' : ''}{scoreDelta}
                    </div>
                  )}
                </Space>
              </Card>
            )
          })}
        </div>

        <Divider />
        <div className="round-result-next-hint">
          {showScoreAnimation ? '确认后进入下一轮，牌桌会自动发牌' : '正在计算积分变化...'}
        </div>
        <div className="round-summary">
          <Text type="secondary">本轮积分: {roundResult.score}</Text>
          <Text strong className="round-summary-loser">{loserSummaryText}</Text>
        </div>
      </div>
    </Modal>
  )
}

export default RoundResult

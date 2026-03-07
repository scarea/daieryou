import React, { useEffect, useState } from 'react'
import { Card, Typography, Space, Button, Tag, Divider, Modal } from 'antd'
import { TrophyOutlined, MehOutlined, FireOutlined } from '@ant-design/icons'
import CardComponent from './Card'
import { getHandTypeName } from '../utils/cardUtils'

const { Title, Text } = Typography

const rankMetaMap = {
  1: { icon: <TrophyOutlined />, color: '#1e9f63', label: '头名' },
  2: { icon: <MehOutlined />, color: '#d17a29', label: '次名' },
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

  const getScoreDelta = (result = {}) => {
    const loserIndexes = roundResult.loserIndexes || (roundResult.loserIndex >= 0 ? [roundResult.loserIndex] : [])
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
    : (selfScoreDelta >= 0 ? '本轮你赢了' : '本轮你输了')
  const resultGridClassName = `round-result-grid ${selfResult ? 'has-self-focus' : ''}`.trim()

  return (
    <Modal
      title={(
        <div className="round-modal-title">
          <Title level={3} className="scene-hero-title">
            第 {roundResult.round} 轮结果
          </Title>
        </div>
      )}
      open={visible}
      onCancel={onClose}
      footer={(
        <Button type="primary" className="scene-primary-btn scene-action-btn" onClick={onClose} size="large" data-testid="round-result-continue">
          继续游戏
        </Button>
      )}
      width={920}
      centered
      className="round-result-modal"
    >
      <div className="round-result-content">
        {selfResult && (
          <div className={`round-self-banner ${selfScoreDelta >= 0 ? 'win' : 'loss'}`}>
            <Text strong>
              {selfOutcomeLabel}
              {' '}
              <span className="round-self-score">
                {selfScoreDelta >= 0 ? '+' : ''}{selfScoreDelta}
              </span>
            </Text>
          </div>
        )}

        {roundResult.publicCard && (
          <Card className="scene-card round-public-card" size="small">
            <Text type="secondary">本轮公牌</Text>
            <div className="round-public-card-inner">
              <CardComponent card={roundResult.publicCard} size="lg" reveal />
            </div>
          </Card>
        )}

        <div className={resultGridClassName}>
          {roundResult.playerResults.map((result) => {
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
              >
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
                      <CardComponent key={cardIndex} card={card} size="sm" reveal />
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
        <div className="round-summary">
          <Text type="secondary">本轮积分: {roundResult.score}</Text>
          <Text strong className="round-summary-loser">
            {(() => {
              const loserIndexes = roundResult.loserIndexes || (roundResult.loserIndex >= 0 ? [roundResult.loserIndex] : [])
              if (loserIndexes.length === 0) return '本轮无输家'
              if (loserIndexes.length === 1) {
                const loserResult = roundResult.playerResults.find((r) => r.playerIndex === loserIndexes[0])
                const loserName = loserResult?.playerName || `玩家${loserIndexes[0] + 1}`
                return `${loserName} 输掉本轮`
              }
              // 多输家场景：更清晰的表述
              const loserNames = loserIndexes.map((loserIdx) => {
                const loserResult = roundResult.playerResults.find((r) => r.playerIndex === loserIdx)
                return loserResult?.playerName || `玩家${loserIdx + 1}`
              })
              return `${loserNames.join('、')} 并列输掉本轮`
            })()}
          </Text>
        </div>
      </div>
    </Modal>
  )
}

export default RoundResult

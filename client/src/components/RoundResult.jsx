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

const RoundResult = ({ roundResult, visible, onClose }) => {
  const [showScoreAnimation, setShowScoreAnimation] = useState(false)

  useEffect(() => {
    if (!visible) {
      setShowScoreAnimation(false)
      return undefined
    }

    const timer = window.setTimeout(() => {
      setShowScoreAnimation(true)
    }, 600)

    return () => {
      window.clearTimeout(timer)
    }
  }, [visible])

  if (!roundResult) {
    return null
  }

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
        {roundResult.publicCard && (
          <Card className="scene-card round-public-card" size="small">
            <Text type="secondary">本轮公牌</Text>
            <div className="round-public-card-inner">
              <CardComponent card={roundResult.publicCard} size="lg" reveal />
            </div>
          </Card>
        )}

        <div className="round-result-grid">
          {roundResult.playerResults.map((result, index) => {
            const rankMeta = rankMetaMap[result.rank] || rankMetaMap[3]
            const isLoser = index === roundResult.loserIndex
            const scoreClassName = isLoser ? 'loss' : 'gain'

            return (
              <Card
                className={`scene-card round-result-player-card rank-${result.rank} ${isLoser ? 'is-loser' : ''}`.trim()}
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
                      {isLoser ? '-' : '+'}{roundResult.score}
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
            {roundResult.playerResults[roundResult.loserIndex]?.playerName || `玩家${roundResult.loserIndex + 1}`} 输掉本轮
          </Text>
        </div>
      </div>
    </Modal>
  )
}

export default RoundResult

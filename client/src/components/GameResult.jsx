import React from 'react'
import { Card, Typography, Space, Button, Table, Tag } from 'antd'
import { TrophyOutlined, CrownOutlined, MehOutlined } from '@ant-design/icons'
import CardComponent from './Card'
import { getHandTypeName } from '../utils/cardUtils'

const { Title, Text } = Typography

const rankColors = ['#ffd15a', '#bac2d0', '#c58646']

const GameResult = ({
  finalScores,
  finalRoundResult = null,
  onBackToRoom,
  onPlayAgain,
  playAgainDisabled = false,
  playAgainText = '再来一局',
}) => {
  const sortedScores = [...finalScores].sort((a, b) => b.totalScore - a.totalScore)

  const getRankIcon = (index) => {
    if (index === 0) {
      return <CrownOutlined />
    }
    if (index === 1) {
      return <TrophyOutlined />
    }
    return <MehOutlined />
  }

  const columns = [
    {
      title: '排名',
      dataIndex: 'rank',
      key: 'rank',
      width: 120,
      render: (_, __, index) => (
        <Space size={8}>
          <span className="result-rank-icon" style={{ color: rankColors[index] || rankColors[2] }}>
            {getRankIcon(index)}
          </span>
          <Text strong style={{ color: rankColors[index] || rankColors[2] }}>
            第{index + 1}名
          </Text>
        </Space>
      ),
    },
    {
      title: '玩家',
      dataIndex: 'username',
      key: 'username',
      render: (username, _, index) => (
        <Text strong className={index === 0 ? 'result-player-first' : ''}>{username}</Text>
      ),
    },
    {
      title: '总积分',
      dataIndex: 'totalScore',
      key: 'totalScore',
      width: 140,
      render: (score) => (
        <Tag color={score > 0 ? 'green' : score < 0 ? 'red' : 'default'}>
          {score > 0 ? '+' : ''}{score}
        </Tag>
      ),
    },
    {
      title: '各轮积分',
      dataIndex: 'roundScores',
      key: 'roundScores',
      render: (roundScores) => (
        <Space size={[4, 8]} wrap>
          {roundScores.map((score, index) => (
            <Tag key={index} color={score > 0 ? 'green' : score < 0 ? 'red' : 'default'}>
              第{index + 1}轮: {score > 0 ? '+' : ''}{score}
            </Tag>
          ))}
        </Space>
      ),
    },
  ]

  return (
    <section className="game-result-shell">
      <Card className="scene-card result-header-card">
        <Space direction="vertical" size={14}>
          <div className="result-title-wrap">
            <TrophyOutlined className="result-title-icon" />
            <Title level={2} className="scene-hero-title" style={{ marginBottom: 8 }}>
              游戏结束
            </Title>
            <Text className="scene-hero-subtitle">恭喜获胜者！</Text>
          </div>

          <div className="result-champion-card">
            <Space align="center">
              <CrownOutlined className="result-champion-icon" />
              <div>
                <Title level={3} className="result-champion-name">
                  {sortedScores[0]?.username}
                </Title>
                <Text className="result-champion-score">
                  总积分: {sortedScores[0]?.totalScore > 0 ? '+' : ''}{sortedScores[0]?.totalScore}
                </Text>
              </div>
            </Space>
          </div>
        </Space>
      </Card>

      <Card className="scene-card result-table-card" title="详细积分统计">
        <Table
          className="result-score-table"
          dataSource={sortedScores}
          columns={columns}
          pagination={false}
          rowKey="playerId"
          size="middle"
          scroll={{ x: 760 }}
        />
      </Card>

      {finalRoundResult && Array.isArray(finalRoundResult.playerResults) && finalRoundResult.playerResults.length > 0 && (
        <Card className="scene-card result-final-reveal-card" title={`第 ${finalRoundResult.round} 轮亮牌`}>
          <div className="round-result-grid">
            {finalRoundResult.playerResults.map((result) => (
              <Card
                key={`${result.playerIndex}-${result.playerName}`}
                className={`scene-card round-result-player-card rank-${result.rank}`.trim()}
                size="small"
              >
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <div className="round-result-player-head">
                    <Text strong className="round-result-player-name">
                      {result.playerName || `玩家${result.playerIndex + 1}`}
                    </Text>
                  </div>

                  <div className="round-result-hand-cards">
                    {result.hand.map((card, cardIndex) => (
                      <CardComponent key={cardIndex} card={card} size="sm" reveal />
                    ))}
                  </div>

                  <div className="round-result-type-tag">
                    <Tag color={result.rank === 2 ? 'red' : 'green'}>
                      {getHandTypeName(result.evaluation.type)}
                    </Tag>
                  </div>
                </Space>
              </Card>
            ))}
          </div>
        </Card>
      )}

      <Card className="scene-card result-action-card">
        <div className="result-action-row">
          <Button
            type="primary"
            className="scene-primary-btn scene-action-btn"
            size="large"
            disabled={playAgainDisabled}
            data-testid="play-again-button"
            onClick={onPlayAgain}
          >
            {playAgainText}
          </Button>

          <Button
            className="scene-subtle-btn scene-action-btn"
            size="large"
            data-testid="leave-room-button"
            onClick={onBackToRoom}
          >
            离开房间
          </Button>
        </div>
      </Card>
    </section>
  )
}

export default GameResult

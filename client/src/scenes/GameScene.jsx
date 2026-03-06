import React, { Suspense, lazy, useEffect, useState } from 'react'
import { Button, Card, Divider, Progress, Space, Tag, Typography, message } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import HandCards from '../components/HandCards'
import CardComponent from '../components/Card'
import ConnectionStatusBanner from '../components/ConnectionStatusBanner'
import useGameStore from '../store/gameStore'
import { getHandTypeName } from '../utils/cardUtils'

const RoundResult = lazy(() => import('../components/RoundResult'))
const GameResult = lazy(() => import('../components/GameResult'))

const { Title, Text } = Typography

const GameScene = () => {
  const {
    user,
    currentRoom,
    gameState,
    startGame,
    restartGame,
    selectCards,
    finalScores,
    latestRoundResult,
    clearLatestRoundResult,
    exitCurrentRoom,
    gameAlert,
    clearGameAlert,
    isConnected,
    isReconnecting,
    reconnectAttempts,
    reconnectNextRetryAt,
  } = useGameStore()

  const [selectedCards, setSelectedCards] = useState([])
  const [loading, setLoading] = useState(false)
  const [showRoundResult, setShowRoundResult] = useState(false)
  const [countdownMs, setCountdownMs] = useState(0)

  useEffect(() => {
    if (!latestRoundResult) {
      return
    }

    setShowRoundResult(true)
    message.success(`第${latestRoundResult.round}轮结束！`)
  }, [latestRoundResult])

  const isHost = currentRoom?.hostId === user?.id
  const currentPlayer = gameState?.players.find((player) => player.id === user?.id)
  const currentRound = gameState?.currentRound || 1
  const maxRounds = gameState?.maxRounds || 5
  const isHiddenRound = currentRound === 4
  const countdownSeconds = Math.ceil(countdownMs / 1000)
  const isCountdownWarning = countdownSeconds <= 5 && countdownSeconds > 0

  useEffect(() => {
    if (!gameState?.roundDeadlineAt) {
      setCountdownMs(0)
      return undefined
    }

    const updateCountdown = () => {
      setCountdownMs(Math.max(0, gameState.roundDeadlineAt - Date.now()))
    }

    updateCountdown()
    const timer = window.setInterval(updateCountdown, 250)
    return () => {
      window.clearInterval(timer)
    }
  }, [gameState?.roundDeadlineAt, currentRound])

  const handlePlayAgain = async () => {
    if (!currentRoom) {
      return
    }

    setLoading(true)
    try {
      await restartGame(currentRoom.id)
      setSelectedCards([])
      clearLatestRoundResult()
      message.success('新一局已开始')
    } catch (error) {
      message.error(error.message || '重新开始失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCardSelect = (cardIndex) => {
    if (selectedCards.includes(cardIndex)) {
      setSelectedCards(selectedCards.filter((index) => index !== cardIndex))
      return
    }

    if (selectedCards.length < 2) {
      setSelectedCards([...selectedCards, cardIndex])
      return
    }

    setSelectedCards([selectedCards[0], cardIndex])
  }

  const handleConfirmSelection = async () => {
    if (!currentRoom || !gameState) {
      return
    }

    if (selectedCards.length !== 2) {
      message.error('请选择2张牌')
      return
    }

    setLoading(true)
    try {
      await selectCards(currentRoom.id, currentRound, selectedCards)
      message.success('选牌成功，等待其他玩家...')
      setSelectedCards([])
    } catch (error) {
      message.error(error.message || '选牌失败')
    } finally {
      setLoading(false)
    }
  }

  const handleStartGame = async () => {
    if (!currentRoom) {
      return
    }

    setLoading(true)
    try {
      await startGame(currentRoom.id)
      message.success('游戏开始！')
    } catch (error) {
      message.error(error.message || '开始游戏失败')
    } finally {
      setLoading(false)
    }
  }

  if (finalScores) {
    return (
      <Suspense fallback={<Card className="scene-card scene-loader-card">正在加载结算面板...</Card>}>
        <GameResult
          finalScores={finalScores}
          onBackToRoom={exitCurrentRoom}
          onPlayAgain={handlePlayAgain}
          playAgainDisabled={!isHost || loading || currentRoom?.players?.length !== 3}
          playAgainText={
            currentRoom?.players?.length !== 3
              ? '人数不足，无法再来一局'
              : !isHost
                ? '等待房主再来一局'
                : '再来一局'
          }
        />
      </Suspense>
    )
  }

  if (!gameState) {
    return (
      <Card className="scene-card game-ready-card" style={{ width: 'min(100%, 900px)' }}>
        <ConnectionStatusBanner
          className="scene-stack-gap"
          gameAlert={gameAlert}
          onClose={clearGameAlert}
          isConnected={isConnected}
          isReconnecting={isReconnecting}
          reconnectAttempts={reconnectAttempts}
          reconnectNextRetryAt={reconnectNextRetryAt}
        />
        <Space direction="vertical" size="large">
          <Title level={3} className="scene-hero-title">准备开始游戏</Title>
          <Text className="scene-hero-subtitle">所有玩家都已就位，点击开始游戏</Text>

          <Space wrap>
            <Button
              type="primary"
              className="scene-primary-btn scene-action-btn"
              size="large"
              loading={loading}
              data-testid="start-game-button"
              onClick={handleStartGame}
              disabled={!isHost || currentRoom?.players?.length !== 3}
            >
              {!isHost ? '等待房主开始' : '开始游戏'}
            </Button>

            <Button className="scene-subtle-btn scene-action-btn" icon={<ArrowLeftOutlined />} data-testid="leave-room-button" onClick={exitCurrentRoom}>
              离开房间
            </Button>
          </Space>
        </Space>
      </Card>
    )
  }

  return (
    <section className="game-scene-shell" aria-label="对局场景">
      <ConnectionStatusBanner
        className="scene-stack-gap"
        gameAlert={gameAlert}
        onClose={clearGameAlert}
        isConnected={isConnected}
        isReconnecting={isReconnecting}
        reconnectAttempts={reconnectAttempts}
        reconnectNextRetryAt={reconnectNextRetryAt}
      />

      <Card className="scene-card game-topbar-card">
        <div className="game-topbar-row">
          <Space wrap size={10}>
            <Button className="scene-subtle-btn" icon={<ArrowLeftOutlined />} data-testid="leave-room-button" onClick={exitCurrentRoom}>
              离开房间
            </Button>
            <Title level={4} className="game-round-indicator" data-testid="round-indicator">
              第 {currentRound} / {maxRounds} 轮
            </Title>
            {isHost && <Tag className="room-status-chip" color="gold">房主</Tag>}
            {countdownSeconds > 0 && (
              <Tag className={isCountdownWarning ? 'round-countdown warning' : 'round-countdown'} color={isCountdownWarning ? 'red' : 'processing'}>
                剩余 {countdownSeconds}s
              </Tag>
            )}
          </Space>

          <Progress className="round-progress-bar" percent={(currentRound / maxRounds) * 100} size="small" />
        </div>
      </Card>

      <Card className="scene-card public-cards-card" title="公牌">
        <div className="public-cards-grid">
          {gameState.publicCards.slice(0, currentRound).map((card, index) => (
            <div className="public-card-slot rhythm-deal-card" key={`${currentRound}-${index}`} style={{ animationDelay: `${index * 70}ms` }}>
              <Text className="scene-hero-subtitle">第{index + 1}张</Text>
              <div className="public-card-wrapper">
                <CardComponent
                  card={isHiddenRound && index === currentRound - 1 ? null : card}
                  size="lg"
                  reveal
                  ariaLabel={`第 ${index + 1} 张公牌`}
                />
              </div>
            </div>
          ))}
        </div>

        {isHiddenRound && (
          <div className="hidden-round-tip">
            <Text type="warning">本轮为暗牌，看不到公牌内容</Text>
          </div>
        )}
      </Card>

      <div className="player-grid">
        {gameState.players.map((player) => {
          const roomPlayer = currentRoom?.players?.find((item) => item.id === player.id)
          const isOffline = roomPlayer?.online === false
          const playerScore = player.roundScores.length > 0
            ? player.roundScores.reduce((sum, score) => sum + score, 0)
            : 0

          return (
            <Card
              className={`scene-card player-status-card ${player.id === user?.id ? 'is-self' : ''} ${isOffline ? 'is-offline' : ''}`.trim()}
              key={player.id}
              title={(
                <Space wrap size={8}>
                  <Text strong={player.id === user?.id}>
                    {player.username}
                    {player.id === user?.id && ' (你)'}
                  </Text>
                  {player.id === currentRoom?.hostId && <Tag color="gold">房主</Tag>}
                  {isOffline && <Tag color="red">离线</Tag>}
                  {player.hasSelected && <Text type="success">✓ 已选</Text>}
                </Space>
              )}
              size="small"
            >
              <div className="player-status-body">
                <Text className="scene-hero-subtitle">
                  手牌: {Array.isArray(player.handCards) ? player.handCards.length : player.handCards} 张
                </Text>
                {player.selectedByTimeout && <Tag color="orange">本轮托管</Tag>}
                <Text>积分: {playerScore}</Text>
              </div>
            </Card>
          )
        })}
      </div>

      {currentPlayer && Array.isArray(currentPlayer.handCards) && (
        <Card className="scene-card hand-card-panel" title="你的手牌">
          <HandCards
            cards={currentPlayer.handCards}
            selectedIndices={selectedCards}
            onCardSelect={handleCardSelect}
            disabled={currentPlayer.hasSelected || loading}
          />

          <div className="hand-action-row">
            {!currentPlayer.hasSelected ? (
              <Space size={12} wrap>
                <Text>请选择2张牌与公牌组合</Text>
                {countdownSeconds > 0 && (
                  <Text type={isCountdownWarning ? 'danger' : 'secondary'}>
                    超时将自动托管选牌
                  </Text>
                )}
                <Button
                  type="primary"
                  className="scene-accent-btn"
                  loading={loading}
                  data-testid="confirm-selection-button"
                  disabled={selectedCards.length !== 2}
                  onClick={handleConfirmSelection}
                >
                  确认选择 ({selectedCards.length}/2)
                </Button>
              </Space>
            ) : (
              <Text type="success">已选择完成，等待其他玩家...</Text>
            )}
          </div>
        </Card>
      )}

      {gameState.roundResults.length > 0 && (
        <Card className="scene-card round-history-card" title="回合历史">
          {gameState.roundResults.map((result) => (
            <section key={result.round} className="round-history-section">
              <Divider orientation="left">第 {result.round} 轮</Divider>
              <div className="round-history-grid">
                {result.playerResults.map((playerResult) => {
                  const player = gameState.players[playerResult.playerIndex]
                  const isLoser = playerResult.playerIndex === result.loserIndex
                  const itemClassName = `history-result-card ${isLoser ? 'is-loser' : ''} ${playerResult.rank === 1 ? 'is-winner' : ''}`.trim()

                  return (
                    <Card key={`${result.round}-${player.id}`} size="small" className={itemClassName}>
                      <Space direction="vertical" size="small" style={{ width: '100%' }}>
                        <Text strong>
                          {player.username} - 第{playerResult.rank}名
                          {isLoser && ' (输)'}
                          {playerResult.selectedByTimeout && ' (托管)'}
                        </Text>

                        <div className="history-hand-cards">
                          {playerResult.hand.map((card, cardIndex) => (
                            <CardComponent key={cardIndex} card={card} size="sm" reveal />
                          ))}
                        </div>

                        <Text type="secondary">{getHandTypeName(playerResult.evaluation.type)}</Text>
                      </Space>
                    </Card>
                  )
                })}
              </div>
            </section>
          ))}
        </Card>
      )}

      <Suspense fallback={null}>
        <RoundResult
          roundResult={latestRoundResult}
          visible={showRoundResult}
          onClose={() => {
            setShowRoundResult(false)
            clearLatestRoundResult()
          }}
        />
      </Suspense>
    </section>
  )
}

export default GameScene

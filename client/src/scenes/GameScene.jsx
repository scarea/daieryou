import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
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
const BOT_DIFFICULTY_LABEL = {
  easy: '简单',
  normal: '标准',
  hard: '进阶',
}
const TABLE_SEAT_ORDER = ['bottom', 'left', 'right']
const CARD_PLAY_ANIMATION_MS = 260
const BGM_STORAGE_KEY = 'daieryou_bgm_muted'
const FINAL_REVEAL_DELAY_MS = 3000
let cardSelectAudioContext = null

function getBotDifficultyLabel(difficulty) {
  const normalized = typeof difficulty === 'string' ? difficulty.trim().toLowerCase() : ''
  return BOT_DIFFICULTY_LABEL[normalized] || BOT_DIFFICULTY_LABEL.normal
}

function readBgmMutedPreference() {
  if (typeof window === 'undefined') {
    return false
  }
  return window.localStorage.getItem(BGM_STORAGE_KEY) === '1'
}

function buildSeatAssignments(players = [], selfPlayerId = '') {
  if (!Array.isArray(players) || players.length === 0) {
    return []
  }

  const selfIndex = players.findIndex((player) => player.id === selfPlayerId)
  const orderedPlayers = selfIndex >= 0
    ? [players[selfIndex], ...players.filter((_, index) => index !== selfIndex)]
    : [...players]

  return orderedPlayers.map((player, index) => ({
    player,
    seat: TABLE_SEAT_ORDER[index] || TABLE_SEAT_ORDER[TABLE_SEAT_ORDER.length - 1],
  }))
}

function playCardSelectSound() {
  if (typeof window === 'undefined') {
    return
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) {
    return
  }

  if (!cardSelectAudioContext) {
    cardSelectAudioContext = new AudioContextClass()
  }

  if (cardSelectAudioContext.state === 'suspended') {
    cardSelectAudioContext.resume().catch(() => {})
  }

  const now = cardSelectAudioContext.currentTime
  const oscillator = cardSelectAudioContext.createOscillator()
  const gainNode = cardSelectAudioContext.createGain()
  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(820, now)
  oscillator.frequency.exponentialRampToValueAtTime(580, now + 0.05)

  gainNode.gain.setValueAtTime(0.0001, now)
  gainNode.gain.exponentialRampToValueAtTime(0.075, now + 0.01)
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)

  oscillator.connect(gainNode)
  gainNode.connect(cardSelectAudioContext.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.1)
}

const FinalRoundRevealStage = ({ roundResult, onConfirm }) => {
  if (!roundResult || !Array.isArray(roundResult.playerResults) || roundResult.playerResults.length === 0) {
    return null
  }

  return (
    <section className="game-result-shell">
      <Card className="scene-card result-final-reveal-card" title={`第 ${roundResult.round} 轮亮牌`}>
        <div className="round-result-grid">
          {roundResult.playerResults.map((result) => (
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

      <Card className="scene-card result-action-card">
        <div className="result-action-row">
          <Button
            type="primary"
            className="scene-primary-btn scene-action-btn"
            size="large"
            data-testid="final-reveal-continue-button"
            onClick={onConfirm}
          >
            查看最终积分
          </Button>
        </div>
      </Card>
    </section>
  )
}

const GameScene = () => {
  const {
    user,
    currentRoom,
    gameState,
    startGame,
    restartGame,
    selectCards,
    finalScores,
    finalRoundResult,
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
  const [playingCardIndices, setPlayingCardIndices] = useState([])
  const [loading, setLoading] = useState(false)
  const [showRoundResult, setShowRoundResult] = useState(false)
  const [showRoundHistory, setShowRoundHistory] = useState(false)
  const [countdownMs, setCountdownMs] = useState(0)
  const [bgmMuted, setBgmMuted] = useState(readBgmMutedPreference)
  const [preFinalRoundAcknowledged, setPreFinalRoundAcknowledged] = useState(false)
  const [finalRevealConfirmed, setFinalRevealConfirmed] = useState(false)
  const [finalRevealReady, setFinalRevealReady] = useState(false)
  const bgmAudioRef = useRef(null)
  const finalRevealDelayTimerRef = useRef(null)
  const isHost = currentRoom?.hostId === user?.id
  const currentPlayer = gameState?.players.find((player) => player.id === user?.id)
  const currentRound = gameState?.currentRound || 1
  const maxRounds = gameState?.maxRounds || 5
  const preFinalRound = Math.max(1, maxRounds - 1)
  const preFinalRoundResult = Array.isArray(gameState?.roundResults)
    ? gameState.roundResults.find((result) => result.round === preFinalRound) || null
    : null
  const hiddenPublicCardIndex = Number.isInteger(gameState?.hiddenPublicCardIndex)
    ? gameState.hiddenPublicCardIndex
    : 3
  const isHiddenRound = currentRound === hiddenPublicCardIndex + 1
  const selectionRequired = gameState?.selectionRequired !== false
  const activePublicCardIndex = selectionRequired
    ? Math.min(
      Math.max(currentRound - 1, 0),
      Math.max(0, (Array.isArray(gameState?.publicCards) ? gameState.publicCards.length : 1) - 1),
    )
    : null
  const countdownSeconds = Math.ceil(countdownMs / 1000)
  const isCountdownWarning = countdownSeconds <= 5 && countdownSeconds > 0
  const isAnimatingCardPlay = playingCardIndices.length > 0
  const seatAssignments = buildSeatAssignments(gameState?.players || [], user?.id)

  const clearFinalRevealDelayTimer = () => {
    if (finalRevealDelayTimerRef.current) {
      window.clearTimeout(finalRevealDelayTimerRef.current)
      finalRevealDelayTimerRef.current = null
    }
  }

  const scheduleFinalRevealDelay = () => {
    clearFinalRevealDelayTimer()
    setFinalRevealReady(false)
    finalRevealDelayTimerRef.current = window.setTimeout(() => {
      setFinalRevealReady(true)
      finalRevealDelayTimerRef.current = null
    }, FINAL_REVEAL_DELAY_MS)
  }

  useEffect(() => {
    if (!latestRoundResult) {
      return
    }

    setShowRoundResult(true)
    message.success(`第${latestRoundResult.round}轮结束！`)
  }, [latestRoundResult])

  const finalRevealSessionKey = finalScores
    ? finalScores
      .map((scoreItem) => `${scoreItem?.playerId || ''}:${scoreItem?.totalScore || 0}`)
      .join('|')
    : ''
  useEffect(() => {
    clearFinalRevealDelayTimer()
    if (!finalScores) {
      setPreFinalRoundAcknowledged(false)
    }
    setFinalRevealConfirmed(false)
    setFinalRevealReady(false)
  }, [finalRevealSessionKey, finalScores])

  useEffect(() => () => {
    clearFinalRevealDelayTimer()
  }, [])

  useEffect(() => {
    if (!finalScores || !preFinalRoundAcknowledged || !preFinalRoundResult) {
      return
    }
    if (finalRevealConfirmed || finalRevealReady || finalRevealDelayTimerRef.current) {
      return
    }

    scheduleFinalRevealDelay()
  }, [
    finalScores,
    preFinalRoundAcknowledged,
    preFinalRoundResult,
    finalRevealConfirmed,
    finalRevealReady,
  ])

  const renderSeatCard = ({ player, seat }) => {
    const roomPlayer = currentRoom?.players?.find((item) => item.id === player.id)
    const isOffline = roomPlayer?.online === false
    const isBot = roomPlayer?.isBot === true
    const playerScore = player.roundScores.length > 0
      ? player.roundScores.reduce((sum, score) => sum + score, 0)
      : 0

    return (
      <div
        key={`${seat}-${player.id}`}
        className={`table-seat seat-${seat} ${player.id === user?.id ? 'is-self' : ''} ${isOffline ? 'is-offline' : ''}`.trim()}
      >
        <div className="table-seat-head">
          <Text strong={player.id === user?.id}>
            {player.username}
            {player.id === user?.id && ' (你)'}
          </Text>
          {isBot && <Tag color="cyan">AI</Tag>}
          {isBot && <Tag color="geekblue">{getBotDifficultyLabel(roomPlayer?.botDifficulty)}</Tag>}
          {player.id === currentRoom?.hostId && <Tag color="gold">房主</Tag>}
          {isOffline && <Tag color="red">离线</Tag>}
        </div>
        <div className="table-seat-body">
          <Text className="scene-hero-subtitle">
            手牌: {Array.isArray(player.handCards) ? player.handCards.length : player.handCards} 张
          </Text>
          <Text>积分: {playerScore}</Text>
          {player.hasSelected && selectionRequired && (
            <Tag color="green" className="table-play-tag">已出牌</Tag>
          )}
          {player.selectedByTimeout && <Tag color="orange">本轮托管</Tag>}
        </div>
      </div>
    )
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(BGM_STORAGE_KEY, bgmMuted ? '1' : '0')
  }, [bgmMuted])

  useEffect(() => {
    const audio = bgmAudioRef.current
    if (!audio) {
      return undefined
    }

    audio.volume = 0.34
    audio.muted = bgmMuted
    const shouldPlay = Boolean(gameState) && !finalScores && !bgmMuted
    if (!shouldPlay) {
      audio.pause()
      return undefined
    }

    let cancelled = false
    const tryPlay = () => {
      if (cancelled) {
        return
      }
      audio.play().catch(() => {})
    }

    tryPlay()
    window.addEventListener('pointerdown', tryPlay, { once: true })
    return () => {
      cancelled = true
      window.removeEventListener('pointerdown', tryPlay)
      audio.pause()
    }
  }, [gameState, finalScores, bgmMuted])

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
      clearFinalRevealDelayTimer()
      setPreFinalRoundAcknowledged(false)
      setFinalRevealConfirmed(false)
      setFinalRevealReady(false)
      clearLatestRoundResult()
      message.success('新一局已开始')
    } catch (error) {
      message.error(error.message || '重新开始失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCardSelect = (cardIndex) => {
    if (!selectionRequired) {
      return
    }

    playCardSelectSound()

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
    if (!selectionRequired) {
      return
    }

    if (selectedCards.length !== 2) {
      message.error('请选择2张牌')
      return
    }

    const orderedSelection = [...selectedCards].sort((left, right) => left - right)
    setPlayingCardIndices(orderedSelection)
    setLoading(true)
    try {
      await new Promise((resolve) => {
        window.setTimeout(resolve, CARD_PLAY_ANIMATION_MS)
      })
      await selectCards(currentRoom.id, currentRound, orderedSelection)
      message.success('选牌成功，等待其他玩家...')
      setSelectedCards([])
    } catch (error) {
      message.error(error.message || '选牌失败')
    } finally {
      setPlayingCardIndices([])
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
    const shouldRequirePreFinalConfirm = Boolean(preFinalRoundResult)
    const finalRevealResult = finalRoundResult
      || gameState?.roundResults?.[gameState.roundResults.length - 1]
      || latestRoundResult
      || null
    if (shouldRequirePreFinalConfirm && !preFinalRoundAcknowledged) {
      return (
        <>
          <section className="game-result-shell">
            <Card className="scene-card result-header-card">
              <Text className="scene-hero-subtitle">请先确认第 {preFinalRound} 轮结算</Text>
            </Card>
          </section>
          <Suspense fallback={null}>
            <RoundResult
              roundResult={preFinalRoundResult}
              visible
              currentPlayerId={user?.id || ''}
              currentUsername={user?.username || ''}
              onClose={() => {
                setShowRoundResult(false)
                clearLatestRoundResult()
                setPreFinalRoundAcknowledged(true)
                scheduleFinalRevealDelay()
              }}
            />
          </Suspense>
        </>
      )
    }

    const canEnterFinalReveal = !shouldRequirePreFinalConfirm || finalRevealReady
    if (finalRevealResult && !finalRevealConfirmed) {
      if (!canEnterFinalReveal) {
        return (
          <section className="game-result-shell">
            <Card className="scene-card result-header-card">
              <Text className="scene-hero-subtitle">第 {maxRounds} 轮亮牌将在 3 秒后自动开始...</Text>
            </Card>
          </section>
        )
      }
      return (
        <FinalRoundRevealStage
          roundResult={finalRevealResult}
          onConfirm={() => {
            setFinalRevealConfirmed(true)
            clearFinalRevealDelayTimer()
            setShowRoundResult(false)
            clearLatestRoundResult()
          }}
        />
      )
    }

    return (
      <Suspense fallback={<Card className="scene-card scene-loader-card">正在加载结算面板...</Card>}>
        <GameResult
          finalScores={finalScores}
          finalRoundResult={null}
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
            <Button className="scene-subtle-btn" onClick={() => setBgmMuted((value) => !value)}>
              {bgmMuted ? '开启音乐' : '静音音乐'}
            </Button>
            <Button className="scene-subtle-btn" onClick={() => setShowRoundHistory((value) => !value)}>
              {showRoundHistory ? '收起历史' : '回合历史'}
            </Button>
          </Space>

          <Progress className="round-progress-bar" percent={(currentRound / maxRounds) * 100} size="small" />
        </div>
      </Card>

      <Card className="scene-card table-arena-card" title="牌桌">
        <div className="table-perspective-wrap">
          <div className="table-felt-surface">
            <div className="table-opponents-row">
              {seatAssignments
                .filter(({ seat }) => seat !== 'bottom')
                .map(renderSeatCard)}
            </div>

            <div className="table-public-zone">
              {gameState.publicCards.map((card, index) => (
                <div
                  className={`public-card-slot rhythm-deal-card ${index === activePublicCardIndex ? 'is-active' : 'is-inactive'}`.trim()}
                  key={`${currentRound}-${index}`}
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <div className="public-card-wrapper">
                    <CardComponent
                      card={index === hiddenPublicCardIndex ? null : card}
                      size="lg"
                      reveal
                      ariaLabel={`第 ${index + 1} 张公牌`}
                    />
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>

        {isHiddenRound && (
          <div className="hidden-round-tip">
            <Text type="warning">本轮为暗牌，看不到公牌内容</Text>
          </div>
        )}
      </Card>

      {currentPlayer && Array.isArray(currentPlayer.handCards) && (
        <Card className="scene-card hand-card-panel" title="你的手牌">
          <HandCards
            cards={currentPlayer.handCards}
            selectedIndices={selectedCards}
            animatingIndices={playingCardIndices}
            onCardSelect={handleCardSelect}
            disabled={currentPlayer.hasSelected || loading || !selectionRequired || isAnimatingCardPlay}
            cardSize="sm"
          />

          <div className="hand-action-row">
            {!currentPlayer.hasSelected && selectionRequired ? (
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
            ) : !selectionRequired ? (
              <Text type="secondary">本轮无公牌，系统将直接按剩余 3 张手牌比大小</Text>
            ) : (
              <Text type="success">已选择完成，等待其他玩家...</Text>
            )}
          </div>
        </Card>
      )}

      {showRoundHistory && gameState.roundResults.length > 0 && (
        <Card className="scene-card round-history-card" title="回合历史">
          {gameState.roundResults.map((result) => (
            <section key={result.round} className="round-history-section">
              <Divider orientation="left">第 {result.round} 轮</Divider>
              <div className="round-history-grid">
                {result.playerResults.map((playerResult) => {
                  const player = gameState.players[playerResult.playerIndex]
                  const loserIndexes = result.loserIndexes || (result.loserIndex >= 0 ? [result.loserIndex] : [])
                  const isLoser = loserIndexes.includes(playerResult.playerIndex)
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
          currentPlayerId={user?.id || ''}
          currentUsername={user?.username || ''}
          onClose={() => {
            const closingRound = Number(latestRoundResult?.round || 0)
            setShowRoundResult(false)
            clearLatestRoundResult()
            if (closingRound === preFinalRound) {
              setPreFinalRoundAcknowledged(true)
              if (finalScores) {
                scheduleFinalRevealDelay()
              }
            }
          }}
        />
      </Suspense>
      <audio ref={bgmAudioRef} src="/audio/game-bgm.wav" preload="auto" loop />
    </section>
  )
}

export default GameScene

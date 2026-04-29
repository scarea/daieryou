import React, { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Button, Card, Divider, Progress, Space, Tag, Typography, message } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import HandCards from '../components/HandCards'
import CardComponent from '../components/Card'
import ConnectionStatusBanner from '../components/ConnectionStatusBanner'
import useGameStore from '../store/gameStore'
import { getHandTypeName } from '../utils/cardUtils'
import audioManager from '../utils/audioManager'
import tableRoomBg from '../assets/game/table-room.svg'
import avatarStrategist from '../assets/game/avatar-strategist.svg'
import avatarCheerful from '../assets/game/avatar-cheerful.svg'
import avatarMaster from '../assets/game/avatar-master.svg'
import avatarBot from '../assets/game/avatar-bot.svg'
import cardBackPattern from '../assets/game/card-back.svg'

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
const TABLE_MOTION_DURATION_MS = 1700
const BGM_STORAGE_KEY = 'daieryou_bgm_muted'
const FINAL_REVEAL_DELAY_MS = 1200
const SEAT_AVATARS = {
  bottom: avatarStrategist,
  left: avatarCheerful,
  right: avatarMaster,
}

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

function getSeatAvatar(player, seat) {
  if (player?.isBot === true) {
    return avatarBot
  }

  return SEAT_AVATARS[seat] || avatarStrategist
}

function getVisibleCardCount(player) {
  return Array.isArray(player?.handCards) ? player.handCards.length : Number(player?.handCards || 0)
}

function getRoundStageText({ selectionRequired, isHiddenRound, currentRound, maxRounds, pendingCount }) {
  if (!selectionRequired) {
    return `第 ${maxRounds} 轮 · 三张底牌终局亮牌`
  }
  if (isHiddenRound) {
    return `第 ${currentRound} 轮 · 暗牌公牌，凭感觉逮二游`
  }
  if (pendingCount > 0) {
    return `第 ${currentRound} 轮 · 等待 ${pendingCount} 位玩家出牌`
  }

  return `第 ${currentRound} 轮 · 正在比牌结算`
}

function getActionText(gameState, fallbackText) {
  const action = gameState?.lastAction
  if (!action?.type) {
    return fallbackText
  }

  const round = Number(action.round || gameState?.currentRound || 1)
  const nextRound = Number(action.nextRound || gameState?.currentRound || round)
  const actionTextMap = {
    deal: `第 ${round} 轮发牌完成，准备出牌`,
    playerSelected: action.pendingCount > 0
      ? `已有玩家出牌，还差 ${action.pendingCount} 位`
      : '三家出牌完成，正在翻牌',
    timeoutAutoSelected: `系统托管 ${action.autoSelectedCount || 1} 位玩家，准备结算`,
    roundAdvanced: `第 ${round} 轮已结算，进入第 ${nextRound} 轮`,
    gameEnded: '终局亮牌完成，查看最终积分',
  }

  return actionTextMap[action.type] || fallbackText
}

function buildMotionCards(action, seatAssignments = []) {
  if (!action?.type || seatAssignments.length === 0) {
    return []
  }

  const seatByPlayerId = new Map(
    seatAssignments.map(({ player, seat }) => [player.id, seat]),
  )
  const cards = []

  const pushCard = ({ variant, from = 'deck', to, index, delayStep = 55 }) => {
    cards.push({
      id: `${action.seq || Date.now()}-${variant}-${to}-${index}-${cards.length}`,
      variant,
      from,
      to,
      delayMs: index * delayStep,
    })
  }

  if (action.type === 'deal' || action.type === 'roundAdvanced') {
    const cardsPerSeat = action.type === 'roundAdvanced' ? 2 : 5
    seatAssignments.forEach(({ seat }, seatIndex) => {
      for (let cardIndex = 0; cardIndex < cardsPerSeat; cardIndex += 1) {
        pushCard({
          variant: 'deal',
          to: seat,
          index: seatIndex * cardsPerSeat + cardIndex,
        })
      }
    })

    if (action.type === 'deal') {
      for (let publicIndex = 0; publicIndex < 4; publicIndex += 1) {
        pushCard({
          variant: 'deal-public',
          to: 'public',
          index: seatAssignments.length * cardsPerSeat + publicIndex,
          delayStep: 50,
        })
      }
    }

    return cards
  }

  if (action.type === 'playerSelected') {
    const fromSeat = seatByPlayerId.get(action.playerId) || 'bottom'
    const selectedCount = Math.max(1, Number(action.selectedCount || 2))
    for (let cardIndex = 0; cardIndex < selectedCount; cardIndex += 1) {
      pushCard({
        variant: 'play',
        from: fromSeat,
        to: 'play',
        index: cardIndex,
        delayStep: 95,
      })
    }

    return cards
  }

  if (action.type === 'timeoutAutoSelected') {
    seatAssignments.forEach(({ seat }, seatIndex) => {
      pushCard({
        variant: 'play timeout',
        from: seat,
        to: 'play',
        index: seatIndex,
        delayStep: 90,
      })
    })
  }

  return cards
}

const FinalRoundRevealStage = ({ roundResult, onConfirm }) => {
  if (!roundResult || !Array.isArray(roundResult.playerResults) || roundResult.playerResults.length === 0) {
    return null
  }

  const sortedResults = [...roundResult.playerResults].sort((left, right) => left.playerIndex - right.playerIndex)
  const revealDelay = (playerIndex, cardIndex) => 520 + ((cardIndex * sortedResults.length + playerIndex) * 320)
  const maxHandLength = Math.max(0, ...sortedResults.map((result) => Array.isArray(result.hand) ? result.hand.length : 0))
  const finalResultDelay = maxHandLength > 0
    ? revealDelay(sortedResults.length - 1, maxHandLength - 1) + 950
    : 1200

  return (
    <section className="game-result-shell final-reveal-shell" style={{ '--final-result-delay': `${finalResultDelay}ms` }}>
      <Card className="scene-card result-final-reveal-card final-round-reveal-card" title={`第 ${roundResult.round} 轮终局比牌`}>
        <div className="final-reveal-kicker">三家底牌将按座位逐张翻开</div>
        <div className="round-result-grid final-round-reveal-grid">
          {sortedResults.map((result, resultIndex) => {
            const isFinalWinner = result.rank !== 2
            return (
              <Card
                key={`${result.playerIndex}-${result.playerName}`}
                className={`scene-card round-result-player-card final-round-player-card rank-${result.rank} ${isFinalWinner ? 'is-final-winner' : 'is-final-loser'}`.trim()}
                size="small"
                style={{ '--reveal-order': resultIndex }}
              >
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div className="round-result-player-head">
                  <Text strong className="round-result-player-name">
                    {result.playerName || `玩家${result.playerIndex + 1}`}
                  </Text>
                </div>

                <div className="round-result-hand-cards final-reveal-hand-cards">
                  {result.hand.map((card, cardIndex) => (
                    <span
                      className="final-flip-card-shell"
                      key={cardIndex}
                      style={{ '--final-card-delay': `${revealDelay(resultIndex, cardIndex)}ms` }}
                    >
                      <CardComponent card={card} size="sm" reveal={false} />
                    </span>
                  ))}
                </div>

                <div className="round-result-type-tag final-reveal-type-tag">
                  <Tag color={result.rank === 2 ? 'red' : 'green'}>
                    {getHandTypeName(result.evaluation.type)}
                  </Tag>
                </div>
              </Space>
              </Card>
            )
          })}
        </div>
      </Card>

      <Card className="scene-card result-action-card final-reveal-action-card">
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
  const [activeMotionSeq, setActiveMotionSeq] = useState(null)
  const bgmAudioRef = useRef(null)
  const finalRevealDelayTimerRef = useRef(null)
  const countdownWarningSecondRef = useRef(null)

  useEffect(() => {
    message.config({
      top: 76,
      duration: 1.6,
      maxCount: 2,
    })
  }, [])

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
  const pendingSelectionCount = (gameState?.players || []).filter((player) => !player.hasSelected).length
  const roundStageText = getRoundStageText({
    selectionRequired,
    isHiddenRound,
    currentRound,
    maxRounds,
    pendingCount: pendingSelectionCount,
  })
  const actionText = getActionText(gameState, roundStageText)
  const actionType = gameState?.lastAction?.type || 'idle'
  const gamePhase = gameState?.phase || (selectionRequired ? 'selecting' : 'final')
  const tableStateClassName = `phase-${gamePhase} action-${actionType}`
  const motionCards = activeMotionSeq === gameState?.lastAction?.seq
    ? buildMotionCards(gameState?.lastAction, seatAssignments)
    : []
  const readyPlayerCount = (gameState?.players || []).filter((player) => player.hasSelected).length
  const totalPlayerCount = (gameState?.players || []).length
  const isSelfSelecting = Boolean(selectionRequired && currentPlayer && !currentPlayer.hasSelected)
  const selectedCount = selectedCards.length
  const selectedProgressPercent = Math.min(100, (selectedCount / 2) * 100)
  const canConfirmSelection = selectedCount === 2 && !loading && !isAnimatingCardPlay
  const waitingPlayers = (gameState?.players || []).filter((player) => selectionRequired && !player.hasSelected)
  const waitingText = waitingPlayers.length > 0
    ? waitingPlayers.map((player) => player.username).join('、')
    : '全部玩家已出牌'
  const tableRoundCueVisible = ['deal', 'roundAdvanced', 'gameEnded'].includes(actionType)
  const phaseSteps = [
    {
      key: 'deal',
      label: '发牌',
      active: ['deal', 'roundAdvanced'].includes(actionType),
      done: actionType !== 'idle',
    },
    {
      key: 'select',
      label: '选牌',
      active: selectionRequired && pendingSelectionCount > 0 && !['deal', 'roundAdvanced'].includes(actionType),
      done: selectionRequired && pendingSelectionCount === 0,
    },
    {
      key: 'reveal',
      label: '翻牌',
      active: ['playerSelected', 'timeoutAutoSelected'].includes(actionType) && pendingSelectionCount === 0,
      done: ['roundAdvanced', 'gameEnded'].includes(actionType),
    },
    {
      key: 'settle',
      label: '结算',
      active: ['roundAdvanced', 'gameEnded'].includes(actionType) || !selectionRequired,
      done: !selectionRequired || actionType === 'gameEnded',
    },
  ]

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
    audioManager.playRoundEnd()
    message.success(`第${latestRoundResult.round}轮结束！`)
  }, [latestRoundResult])

  useEffect(() => {
    if (!gameState?.lastAction?.seq) {
      return undefined
    }

    if (!['deal', 'roundAdvanced', 'playerSelected', 'timeoutAutoSelected'].includes(gameState.lastAction.type)) {
      return undefined
    }

    setActiveMotionSeq(gameState.lastAction.seq)
    const timer = window.setTimeout(() => {
      setActiveMotionSeq((currentSeq) => (
        currentSeq === gameState.lastAction.seq ? null : currentSeq
      ))
    }, TABLE_MOTION_DURATION_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [gameState?.lastAction?.seq, gameState?.lastAction?.type])

  useEffect(() => {
    if (!finalScores) {
      return
    }

    const selfFinalScore = finalScores.find((scoreItem) => scoreItem.playerId === user?.id)
    if (!selfFinalScore) {
      audioManager.playRoundEnd()
      return
    }

    if (Number(selfFinalScore.totalScore || 0) >= 0) {
      audioManager.playWin()
      return
    }

    audioManager.playLose()
  }, [finalScores, user?.id])

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
    const isSelf = player.id === user?.id
    const playerScore = player.roundScores.length > 0
      ? player.roundScores.reduce((sum, score) => sum + score, 0)
      : 0
    const visibleCardCount = getVisibleCardCount(player)
    const avatarSrc = getSeatAvatar({ ...player, isBot }, seat)
    const isThinking = Boolean(selectionRequired && !player.hasSelected && isBot)
    const seatStatus = !selectionRequired
      ? { label: '亮牌中', className: 'final' }
      : player.hasSelected
        ? { label: player.selectedByTimeout ? '托管出牌' : '已出牌', className: 'played' }
        : isThinking
          ? { label: '思考中', className: 'thinking' }
          : isSelf
            ? { label: '轮到你', className: 'self-turn' }
            : { label: '等待中', className: 'waiting' }

    return (
      <div
        key={`${seat}-${player.id}`}
        className={`table-seat seat-${seat} ${isSelf ? 'is-self' : ''} ${isOffline ? 'is-offline' : ''} ${player.hasSelected && selectionRequired ? 'has-played' : ''} ${isThinking ? 'is-thinking' : ''}`.trim()}
      >
        <div className="seat-avatar-wrap">
          <img className="seat-avatar" src={avatarSrc} alt={`${player.username} 角色头像`} />
          {player.hasSelected && selectionRequired && <span className="seat-ready-badge">出</span>}
        </div>
        <div className="table-seat-panel">
          <div className="table-seat-head">
            <Text strong={isSelf}>
              {player.username}
              {isSelf && ' · 你'}
            </Text>
            <div className="seat-tags">
              {isBot && <Tag color="cyan">AI</Tag>}
              {isBot && <Tag color="geekblue">{getBotDifficultyLabel(roomPlayer?.botDifficulty)}</Tag>}
              {player.id === currentRoom?.hostId && <Tag color="gold">房主</Tag>}
              {isOffline && <Tag color="red">离线</Tag>}
              {player.selectedByTimeout && <Tag color="orange">托管</Tag>}
            </div>
          </div>
          <div className="table-seat-body">
            <span>手牌 {visibleCardCount}</span>
            <span className={`seat-status-chip ${seatStatus.className}`}>{seatStatus.label}</span>
            <span className={playerScore >= 0 ? 'seat-score gain' : 'seat-score loss'}>{playerScore >= 0 ? '+' : ''}{playerScore}</span>
          </div>
          {!isSelf && (
            <div className="opponent-card-fan" aria-label={`${player.username} 手牌背面`}>
              {Array.from({ length: Math.min(visibleCardCount, 5) }).map((_, index) => (
                <span key={index} style={{ '--fan-index': index }} />
              ))}
            </div>
          )}
        </div>
        {isThinking && (
          <div className="seat-thinking-bubble" aria-label={`${player.username} 正在思考`}>
            <span />
            <span />
            <span />
          </div>
        )}
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
      countdownWarningSecondRef.current = null
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

  useEffect(() => {
    if (!isCountdownWarning || currentPlayer?.hasSelected) {
      countdownWarningSecondRef.current = null
      return
    }

    if (countdownWarningSecondRef.current === countdownSeconds) {
      return
    }

    countdownWarningSecondRef.current = countdownSeconds
    audioManager.playCountdownWarning()
  }, [countdownSeconds, isCountdownWarning, currentPlayer?.hasSelected])

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

    audioManager.playCardSelect()

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
      audioManager.playCardPlay()
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
          <section className="game-result-shell final-reveal-wait-shell">
            <Card className="scene-card result-header-card final-reveal-wait-card">
              <div className="final-reveal-wait-visual">
                <span />
                <span />
                <span />
              </div>
              <Title level={3} className="scene-hero-title">准备比牌</Title>
              <Text className="scene-hero-subtitle">第 {maxRounds} 轮即将开始，三家底牌将依次翻开</Text>
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

      <Card className="scene-card table-arena-card" title="2.5D 逮二游牌桌">
        <div
          className={`table-room-stage ${tableStateClassName} ${isHiddenRound ? 'is-hidden-round' : ''} ${isCountdownWarning ? 'is-countdown-warning' : ''} ${isSelfSelecting ? 'is-self-selecting' : ''}`.trim()}
          style={{
            '--table-room-bg': `url(${tableRoomBg})`,
            '--card-back-pattern': `url(${cardBackPattern})`,
          }}
        >
          <div className="table-stage-hud compact-round-hud" aria-live="polite">
            <Text strong>{actionText}</Text>
            <span className="compact-round-divider" />
            <div className="compact-round-steps" aria-label="回合流程">
              {phaseSteps.map((step) => (
                <span
                  key={step.key}
                  className={`phase-step ${step.active ? 'is-active' : ''} ${step.done ? 'is-done' : ''}`.trim()}
                >
                  {step.label}
                </span>
              ))}
            </div>
            {isHiddenRound && <Tag color="warning">暗牌</Tag>}
            {!selectionRequired && <Tag color="purple">终局</Tag>}
          </div>

          {tableRoundCueVisible && (
            <div key={`round-cue-${gameState?.lastAction?.seq || currentRound}`} className="round-stage-cue" aria-live="polite">
              <span>{!selectionRequired ? '终局亮牌' : `第 ${currentRound} 轮`}</span>
              <strong>{actionText}</strong>
            </div>
          )}

          {isHiddenRound && selectionRequired && (
            <div className="hidden-round-warning">
              暗牌回合：第 {hiddenPublicCardIndex + 1} 张公牌隐藏，凭手牌和记牌判断
            </div>
          )}

          {motionCards.length > 0 && (
            <div className="table-motion-layer" aria-hidden="true">
              {motionCards.map((motionCard) => (
                <span
                  key={motionCard.id}
                  className={`motion-card motion-${motionCard.variant} from-${motionCard.from} to-${motionCard.to}`}
                  style={{ '--motion-delay': `${motionCard.delayMs}ms` }}
                />
              ))}
            </div>
          )}

          <div className="table-actor-layer">
            {seatAssignments.map(renderSeatCard)}
          </div>

          <div className="table-status-rail" aria-live="polite">
            <span>{readyPlayerCount}/{totalPlayerCount} 已出牌</span>
            <span>{selectionRequired ? `等待：${waitingText}` : '终局亮牌中'}</span>
          </div>

          <div className="table-center-layer" aria-label="牌桌中央区域">
            <div className="table-felt-oval" aria-hidden="true" />
            <div className="deck-stack" aria-label={`牌堆剩余 ${gameState.deck} 张`}>
              <span />
              <span />
              <span />
              <Text className="deck-count">{gameState.deck}</Text>
            </div>

            <div className="table-public-zone">
              {gameState.publicCards.map((card, index) => (
                <div
                  className={`public-card-slot rhythm-deal-card ${index === activePublicCardIndex ? 'is-active' : 'is-inactive'} ${index === hiddenPublicCardIndex ? 'is-hidden-card' : ''}`.trim()}
                  key={`${currentRound}-${index}`}
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <div className="public-card-label">公牌 {index + 1}</div>
                  {index === hiddenPublicCardIndex && <span className="public-card-lock">暗牌</span>}
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

            <div className="play-lane">
              <div className="play-lane-title">出牌区</div>
              {currentPlayer?.hasSelected && selectionRequired ? (
                <div className="play-lane-waiting">
                  <Text type="success">你已出牌，等待翻牌</Text>
                  <span>{pendingSelectionCount > 0 ? `还差 ${pendingSelectionCount} 位` : '准备翻牌'}</span>
                </div>
              ) : selectedCards.length > 0 && currentPlayer ? (
                <div className="selected-preview-cards">
                  {selectedCards.map((cardIndex) => (
                    <CardComponent key={cardIndex} card={currentPlayer.handCards[cardIndex]} size="sm" reveal />
                  ))}
                </div>
              ) : (
                <span className="play-lane-empty" aria-hidden="true" />
              )}
              <div className="play-lane-progress">
                <span className={selectedCount >= 1 || currentPlayer?.hasSelected ? 'is-on' : ''} />
                <span className={selectedCount >= 2 || currentPlayer?.hasSelected ? 'is-on' : ''} />
              </div>
            </div>
          </div>

          {currentPlayer && Array.isArray(currentPlayer.handCards) && (
            <div className="table-hand-dock" aria-label="你的手牌">
              <div className="table-hand-header">
                <Space size={8} wrap>
                  <span className="table-hand-title">你的手牌</span>
                  {!currentPlayer.hasSelected && selectionRequired ? (
                    <Tag color="gold">请选择 2 张</Tag>
                  ) : !selectionRequired ? (
                    <Tag color="purple">终局亮牌</Tag>
                  ) : (
                    <Tag color="success">已出牌</Tag>
                  )}
                </Space>
              </div>

              <div className="selection-meter" aria-label={`已选择 ${selectedCount} 张`}>
                <span style={{ width: `${selectedProgressPercent}%` }} />
              </div>

              <HandCards
                cards={currentPlayer.handCards}
                selectedIndices={selectedCards}
                animatingIndices={playingCardIndices}
                onCardSelect={handleCardSelect}
                disabled={currentPlayer.hasSelected || loading || !selectionRequired || isAnimatingCardPlay}
                cardSize="md"
              />

              <div className="hand-action-row table-hand-actions">
                {!currentPlayer.hasSelected && selectionRequired ? (
                  <Space size={12} wrap>
                    <Button
                      type="primary"
                      className="scene-accent-btn table-confirm-button"
                      loading={loading}
                      data-testid="confirm-selection-button"
                      disabled={!canConfirmSelection}
                      onClick={handleConfirmSelection}
                    >
                      确认出牌 ({selectedCards.length}/2)
                    </Button>
                  </Space>
                ) : !selectionRequired ? (
                  <Text type="secondary">本轮无公牌，系统将直接按剩余 3 张手牌比大小</Text>
                ) : (
                  <Text type="success">已选择完成，等待其他玩家...</Text>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>

      {showRoundHistory && (
        <div className="round-history-overlay" aria-label="回合历史侧栏">
          <button
            type="button"
            className="round-history-backdrop"
            aria-label="关闭回合历史"
            onClick={() => setShowRoundHistory(false)}
          />
          <aside className="round-history-drawer">
            <div className="round-history-drawer-head">
              <div>
                <Text strong>回合历史</Text>
                <span>复盘每轮牌型与分数</span>
              </div>
              <Button className="scene-subtle-btn" size="small" onClick={() => setShowRoundHistory(false)}>
                关闭
              </Button>
            </div>

            {gameState.roundResults.length === 0 ? (
              <div className="round-history-empty">本局还没有已结算回合</div>
            ) : (
              gameState.roundResults.map((result) => (
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
              ))
            )}
          </aside>
        </div>
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

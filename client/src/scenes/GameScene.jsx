import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Divider, Space, Tag, Typography, message } from 'antd'
import { ArrowLeftOutlined, HistoryOutlined } from '@ant-design/icons'
import CardComponent from '../components/Card'
import ConnectionStatusBanner from '../components/ConnectionStatusBanner'
import RoundResultBar from '../components/RoundResultBar'
import AnimatedNumber from '../components/AnimatedNumber'
import EmoteBar from '../components/EmoteBar'
import CoachMarks from '../components/CoachMarks'
import useGameStore from '../store/gameStore'
import useTableUiStore from '../three/tableUiStore'
import { buildSeatAssignments } from '../three/layout'
import { buildShowdownTimeline, getShowdownKey } from '../three/showdown'
import { getCardName, getHandTypeName } from '../utils/cardUtils'
import { previewHand } from '../utils/handPreview'
import soundEngine, { seatPan } from '../audio/soundEngine'
import { playSkippedShowdown, scheduleShowdownSounds } from '../audio/showdownSounds'
import useSettingsStore, { tapFeedback } from '../settings/settingsStore'
import { realtimeClient } from '../services/realtimeClient'

const GameResult = lazy(() => import('../components/GameResult'))

const { Title, Text } = Typography
const CARD_PLAY_ANIMATION_MS = 260
const FINAL_REVEAL_DELAY_MS = 1200
const RESULT_BAR_AUTO_DISMISS_MS = 6500
const SCOREBOARD_ROW_HEIGHT = 34
const COUNTDOWN_RING_RADIUS = 17
const COUNTDOWN_RING_LENGTH = 2 * Math.PI * COUNTDOWN_RING_RADIUS

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

// 终局比牌：牌已在 3D 牌桌上翻开，这里只保留紧凑的名次/牌型条
const FinalRoundRevealStage = ({ roundResult, onConfirm }) => {
  if (!roundResult || !Array.isArray(roundResult.playerResults) || roundResult.playerResults.length === 0) {
    return null
  }

  const sortedResults = [...roundResult.playerResults].sort((left, right) => left.playerIndex - right.playerIndex)

  return (
    <section className="game-result-shell final-reveal-shell hud-result-shell">
      <Card className="scene-card result-final-reveal-card final-round-reveal-card" title={`第 ${roundResult.round} 轮终局比牌`}>
        <div className="round-result-grid final-round-reveal-grid">
          {sortedResults.map((result) => (
            <Card
              key={`${result.playerIndex}-${result.playerName}`}
              className={`scene-card round-result-player-card final-round-player-card rank-${result.rank} ${result.rank !== 2 ? 'is-final-winner' : 'is-final-loser'}`}
              size="small"
            >
              <div className="final-reveal-row">
                <Text strong className="round-result-player-name">
                  {result.playerName || `玩家${result.playerIndex + 1}`}
                </Text>
                <span className="final-reveal-cards">{(result.hand || []).map(getCardName).join(' ')}</span>
                <Tag color={result.rank === 2 ? 'red' : 'green'}>{getHandTypeName(result.evaluation.type)}</Tag>
              </div>
            </Card>
          ))}
        </div>
      </Card>

      <Card className="scene-card result-action-card final-reveal-action-card">
        <div className="result-action-row">
          <Button
            type="primary"
            className="hud-cta"
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

const CountdownRing = ({ remainingMs, totalMs, warning }) => {
  const seconds = Math.ceil(remainingMs / 1000)
  const ratio = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0
  return (
    <div className={`hud-countdown ${warning ? 'is-warning' : ''}`} role="timer" aria-label={`剩余 ${seconds} 秒`}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r={COUNTDOWN_RING_RADIUS} className="hud-countdown-track" />
        <circle
          cx="20"
          cy="20"
          r={COUNTDOWN_RING_RADIUS}
          className="hud-countdown-fill"
          strokeDasharray={COUNTDOWN_RING_LENGTH}
          strokeDashoffset={COUNTDOWN_RING_LENGTH * (1 - ratio)}
        />
      </svg>
      <span>{seconds}</span>
    </div>
  )
}

// 积分榜：按总分排序，名次变化时行会平滑换位，数字滚动
const Scoreboard = ({ seatAssignments, selectionRequired, currentUserId }) => {
  const ordered = [...seatAssignments].sort((left, right) => (
    Number(right.player.totalScore || 0) - Number(left.player.totalScore || 0)
  ))
  return (
    <aside
      className="hud-panel hud-scoreboard"
      aria-label="积分榜"
      style={{ '--scoreboard-rows': seatAssignments.length, '--scoreboard-row-height': `${SCOREBOARD_ROW_HEIGHT}px` }}
    >
      {seatAssignments.map(({ player, seat }) => {
        const isSelf = player.id === currentUserId
        const total = Number(player.totalScore || 0)
        const place = ordered.findIndex((item) => item.player.id === player.id)
        return (
          <div
            key={player.id}
            className={`hud-score-row seat-${seat} ${isSelf ? 'is-self' : ''}`}
            style={{ '--score-place': place }}
          >
            <span className="hud-score-dot" />
            <span className="hud-score-name">{player.username}{isSelf ? '（你）' : ''}</span>
            <span className={`hud-score-state ${player.hasSelected && selectionRequired ? 'is-ready' : ''}`}>
              {!selectionRequired ? '亮牌' : player.hasSelected ? '已出' : '选牌中'}
            </span>
            <AnimatedNumber value={total} signed className={`hud-score-total ${total >= 0 ? 'gain' : 'loss'}`} />
          </div>
        )
      })}
    </aside>
  )
}

// 选牌实时预览：两张手牌 + 本轮公牌 = 什么牌型；暗牌轮额外提示终局三张
const HandPreview = ({ handCards, selectedCards, publicCard, isHiddenRound }) => {
  const selected = selectedCards.map((index) => handCards[index]).filter(Boolean)
  if (selected.length === 0) {
    return (
      <span className="hud-hand-hint">
        {isHiddenRound ? '暗牌回合：选 2 张手牌，与看不见的公牌组成三张' : '点选或向上拖动 2 张手牌，与本轮公牌组成三张'}
      </span>
    )
  }

  const names = selected.map(getCardName).join(' ')
  if (selected.length < 2) {
    return <span className="hud-hand-hint">已选 <strong>{names}</strong>，再选 1 张</span>
  }

  if (isHiddenRound || !publicCard) {
    const remaining = handCards.filter((_, index) => !selectedCards.includes(index))
    const finalPreview = remaining.length === 3 ? previewHand(remaining) : null
    return (
      <span className="hud-hand-hint">
        <strong>{names}</strong> + 暗牌
        {finalPreview && <span className="hud-hand-sub">终局底牌：{finalPreview.text}</span>}
      </span>
    )
  }

  const preview = previewHand([...selected, publicCard])
  return (
    <span className="hud-hand-hint">
      <strong>{names}</strong> + {getCardName(publicCard)} =
      <span className={`hud-hand-type type-${preview?.evaluation.type}`}>{preview?.text}</span>
      {preview?.usesWildcard && <span className="hud-hand-sub">赖子已自动变牌</span>}
    </span>
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
    finalRoundResults,
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
  const selectedCards = useTableUiStore((state) => state.selectedCards)
  const playingCardIndices = useTableUiStore((state) => state.playingCardIndices)
  const showdown = useTableUiStore((state) => state.showdown)
  const toggleCard = useTableUiStore((state) => state.toggleCard)
  const clearSelection = useTableUiStore((state) => state.clearSelection)
  const setPlayingCardIndices = useTableUiStore((state) => state.setPlayingCardIndices)
  const setBusy = useTableUiStore((state) => state.setBusy)
  const setRevealResult = useTableUiStore((state) => state.setRevealResult)
  const startShowdown = useTableUiStore((state) => state.startShowdown)
  const skipShowdown = useTableUiStore((state) => state.skipShowdown)
  const clearShowdown = useTableUiStore((state) => state.clearShowdown)
  const setUrgent = useTableUiStore((state) => state.setUrgent)
  const playIntro = useTableUiStore((state) => state.playIntro)
  const setPodium = useTableUiStore((state) => state.setPodium)
  const pushEmote = useTableUiStore((state) => state.pushEmote)
  const pruneEmotes = useTableUiStore((state) => state.pruneEmotes)
  const resetTableUi = useTableUiStore((state) => state.reset)
  const reducedMotion = useSettingsStore((state) => state.reducedMotion)
  const musicVolume = useSettingsStore((state) => state.musicVolume)
  const muted = useSettingsStore((state) => state.muted)

  const [loading, setLoadingState] = useState(false)
  const [showRoundHistory, setShowRoundHistory] = useState(false)
  const [countdownMs, setCountdownMs] = useState(0)
  const [preFinalRoundAcknowledged, setPreFinalRoundAcknowledged] = useState(false)
  const [finalRevealConfirmed, setFinalRevealConfirmed] = useState(false)
  const [finalRevealReady, setFinalRevealReady] = useState(false)
  const [completedShowdownKey, setCompletedShowdownKey] = useState(null)
  const bgmAudioRef = useRef(null)
  const finalRevealDelayTimerRef = useRef(null)
  const countdownSecondRef = useRef(null)
  const cancelShowdownSoundsRef = useRef(null)
  const previousSelectedRef = useRef(new Map())
  const lastActionSeqRef = useRef(null)

  const setLoading = (value) => {
    setLoadingState(value)
    setBusy(value)
  }

  useEffect(() => {
    message.config({
      top: 84,
      duration: 1.6,
      maxCount: 2,
    })
  }, [])

  useEffect(() => () => {
    cancelShowdownSoundsRef.current?.()
    resetTableUi()
  }, [resetTableUi])

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
  const countdownSeconds = Math.ceil(countdownMs / 1000)
  const isCountdownWarning = countdownSeconds <= 5 && countdownSeconds > 0
  const isAnimatingCardPlay = playingCardIndices.length > 0
  const seatAssignments = useMemo(
    () => buildSeatAssignments(gameState?.players || [], user?.id),
    [gameState?.players, user?.id],
  )
  const seatByPlayerId = useMemo(
    () => new Map(seatAssignments.map(({ player, seat }) => [player.id, seat])),
    [seatAssignments],
  )
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
  const selectedCount = selectedCards.length
  const canConfirmSelection = selectedCount === 2 && !loading && !isAnimatingCardPlay
  const isSelfSelecting = Boolean(selectionRequired && currentPlayer && !currentPlayer.hasSelected)
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

  // 换轮时清空本地选牌
  useEffect(() => {
    clearSelection()
  }, [currentRound, clearSelection])

  useEffect(() => {
    if (!finalScores) {
      return
    }
    const selfFinalScore = finalScores.find((scoreItem) => scoreItem.playerId === user?.id)
    if (selfFinalScore && Number(selfFinalScore.totalScore || 0) < 0) {
      tapFeedback([20, 60, 20])
    }
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

  // ---------- 结算流程：决定现在要演哪一轮 ----------
  const finalRevealResult = finalRoundResult
    || gameState?.roundResults?.[gameState.roundResults.length - 1]
    || latestRoundResult
    || null
  const shouldRequirePreFinalConfirm = Boolean(preFinalRoundResult)
  const canEnterFinalReveal = !shouldRequirePreFinalConfirm || finalRevealReady
  let finalStage = null
  let showdownTarget = null
  let showdownIsFinal = false
  if (finalScores) {
    if (shouldRequirePreFinalConfirm && !preFinalRoundAcknowledged) {
      finalStage = 'preFinal'
      showdownTarget = preFinalRoundResult
    } else if (finalRevealResult && !finalRevealConfirmed) {
      finalStage = canEnterFinalReveal ? 'finalReveal' : 'waiting'
      if (canEnterFinalReveal) {
        showdownTarget = finalRevealResult
        showdownIsFinal = true
      }
    } else {
      finalStage = 'result'
    }
  } else if (latestRoundResult) {
    showdownTarget = latestRoundResult
  }
  const baseShowdownKey = getShowdownKey(showdownTarget)
  const showdownKey = baseShowdownKey ? `${baseShowdownKey}:${showdownIsFinal ? 'final' : 'round'}` : null
  const showdownDone = Boolean(showdownKey) && completedShowdownKey === showdownKey

  useEffect(() => {
    cancelShowdownSoundsRef.current?.()
    cancelShowdownSoundsRef.current = null
    if (!showdownKey || !showdownTarget) {
      clearShowdown()
      setRevealResult(null)
      return undefined
    }

    const timeline = buildShowdownTimeline(showdownTarget, { reducedMotion, isFinal: showdownIsFinal })
    const nextShowdown = { key: showdownKey, timeline, startedAt: performance.now() }
    startShowdown(nextShowdown)
    setRevealResult(showdownTarget)
    cancelShowdownSoundsRef.current = scheduleShowdownSounds(nextShowdown, { seatByPlayerId, selfId: user?.id })
    const timer = window.setTimeout(() => setCompletedShowdownKey(showdownKey), timeline.endAt)
    return () => window.clearTimeout(timer)
    // 只在切换到新的结算时重新开始演出
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showdownKey])

  // 演出中点任意位置跳过
  useEffect(() => {
    if (!showdown || showdownDone) {
      return undefined
    }
    const handleSkip = (event) => {
      if (event.target?.closest?.('.hud-game-bar, .settings-dock, .ant-popover')) {
        return
      }
      cancelShowdownSoundsRef.current?.()
      cancelShowdownSoundsRef.current = null
      playSkippedShowdown(showdown, { selfId: user?.id })
      skipShowdown()
      setCompletedShowdownKey(showdown.key)
    }
    window.addEventListener('pointerdown', handleSkip, true)
    return () => window.removeEventListener('pointerdown', handleSkip, true)
  }, [showdown, showdownDone, skipShowdown, user?.id])

  // 终局领奖台
  useEffect(() => {
    if (finalStage !== 'result' || !finalScores) {
      setPodium(null)
      return
    }
    const players = gameState?.players || currentRoom?.players || []
    const seats = buildSeatAssignments(players, user?.id)
    const entries = [...finalScores]
      .sort((left, right) => right.totalScore - left.totalScore)
      .map((score) => ({
        playerId: score.playerId,
        username: score.username,
        totalScore: score.totalScore,
        isSelf: score.playerId === user?.id,
        isBot: currentRoom?.players?.find((player) => player.id === score.playerId)?.isBot === true,
        seat: seats.find((item) => item.player.id === score.playerId)?.seat || 'bottom',
      }))
    setPodium(entries)
    soundEngine.chipCascade({ count: 10, spacing: 0.06 })
    soundEngine.winChime({ at: 0.4 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalStage, finalRevealSessionKey])

  // ---------- 声音与触感 ----------

  // 背景音乐：音量/静音跟随设置
  useEffect(() => {
    const audio = bgmAudioRef.current
    if (!audio) {
      return undefined
    }

    audio.volume = Math.max(0, Math.min(1, musicVolume))
    audio.muted = muted
    const shouldPlay = Boolean(gameState) && !finalScores && !muted && musicVolume > 0
    if (!shouldPlay) {
      audio.pause()
      return undefined
    }

    let cancelled = false
    const tryPlay = () => {
      if (!cancelled) {
        audio.play().catch(() => {})
      }
    }
    tryPlay()
    window.addEventListener('pointerdown', tryPlay, { once: true })
    return () => {
      cancelled = true
      window.removeEventListener('pointerdown', tryPlay)
    }
  }, [gameState, finalScores, muted, musicVolume])

  useEffect(() => () => {
    bgmAudioRef.current?.pause()
  }, [])

  // 发牌 / 换轮：洗牌声、发牌声、镜头扫向公牌
  useEffect(() => {
    const action = gameState?.lastAction
    if (!action?.seq || lastActionSeqRef.current === action.seq) {
      return undefined
    }
    const isFirstSync = lastActionSeqRef.current === null
    lastActionSeqRef.current = action.seq
    if (isFirstSync && action.type !== 'deal') {
      return undefined
    }

    const pans = seatAssignments.map(({ seat }) => seatPan(seat))
    if (action.type === 'deal') {
      soundEngine.shuffle()
      soundEngine.deal({ count: 19, at: 0.9, pans: [...pans, 0] })
      playIntro(1600)
      return undefined
    }
    if (action.type === 'roundAdvanced') {
      // 等结算演出结束再发新牌的声音
      const { showdown: activeShowdown } = useTableUiStore.getState()
      const wait = activeShowdown
        ? Math.max(0, activeShowdown.startedAt + activeShowdown.timeline.endAt - performance.now())
        : 0
      const timer = window.setTimeout(() => {
        soundEngine.deal({ count: 6, pans })
      }, wait)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [gameState?.lastAction, seatAssignments, playIntro])

  // 对手出牌：从对应方向传来“刷—嗒”
  useEffect(() => {
    const previous = previousSelectedRef.current
    ;(gameState?.players || []).forEach((player) => {
      const was = previous.get(player.id)
      if (was === false && player.hasSelected && player.id !== user?.id && selectionRequired) {
        const pan = seatPan(seatByPlayerId.get(player.id))
        soundEngine.cardSlide({ pan })
        soundEngine.cardPlace({ at: 0.12, pan })
        soundEngine.cardPlace({ at: 0.2, pan, soft: 0.7 })
      }
      previous.set(player.id, Boolean(player.hasSelected))
    })
  }, [gameState?.players, selectionRequired, seatByPlayerId, user?.id])

  useEffect(() => {
    if (!gameState?.roundDeadlineAt) {
      setCountdownMs(0)
      countdownSecondRef.current = null
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

  // 倒计时：最后 10 秒木质轻敲，最后 5 秒心跳 + 手牌轻颤
  useEffect(() => {
    const urgent = isCountdownWarning && isSelfSelecting
    setUrgent(urgent)
    if (!isSelfSelecting || countdownSeconds <= 0 || countdownSeconds > 10) {
      countdownSecondRef.current = null
      return
    }
    if (countdownSecondRef.current === countdownSeconds) {
      return
    }
    countdownSecondRef.current = countdownSeconds
    if (countdownSeconds <= 5) {
      soundEngine.heartbeat({ intensity: 0.6 + (5 - countdownSeconds) * 0.12 })
      tapFeedback(15)
    } else {
      soundEngine.woodTick({ pitch: 0.9 })
    }
  }, [countdownSeconds, isCountdownWarning, isSelfSelecting, setUrgent])

  // 表情：收到后在对应座位冒气泡
  useEffect(() => {
    const handleEmote = (payload) => {
      if (!payload?.fromId || payload.roomId !== currentRoom?.id) {
        return
      }
      pushEmote(payload)
      soundEngine.emotePop({ pan: seatPan(seatByPlayerId.get(payload.fromId)) })
      window.setTimeout(pruneEmotes, 3400)
    }
    realtimeClient.on('emote', handleEmote)
    return () => realtimeClient.off('emote', handleEmote)
  }, [currentRoom?.id, seatByPlayerId, pushEmote, pruneEmotes])

  // ---------- 操作 ----------

  const handleConfirmSelection = useCallback(async () => {
    if (!currentRoom || !gameState || !selectionRequired) {
      return
    }
    const { selectedCards: currentSelection } = useTableUiStore.getState()
    if (currentSelection.length !== 2) {
      message.error('请选择2张牌')
      return
    }

    const orderedSelection = [...currentSelection].sort((left, right) => left - right)
    setPlayingCardIndices(orderedSelection)
    setLoading(true)
    soundEngine.cardSlide()
    soundEngine.cardSlide({ at: 0.06 })
    tapFeedback(14)
    try {
      await new Promise((resolve) => {
        window.setTimeout(resolve, CARD_PLAY_ANIMATION_MS)
      })
      soundEngine.cardPlace()
      soundEngine.cardPlace({ at: 0.07, soft: 0.8 })
      await selectCards(currentRoom.id, currentRound, orderedSelection)
      clearSelection()
    } catch (error) {
      message.error(error.message || '选牌失败')
    } finally {
      setPlayingCardIndices([])
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRoom, gameState, selectionRequired, currentRound, selectCards])

  // 键盘：1-5 选牌，回车出牌，Esc 取消
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.target?.closest?.('input, textarea, [contenteditable="true"]')) {
        return
      }
      if (!isSelfSelecting || loading || !currentPlayer || !Array.isArray(currentPlayer.handCards)) {
        return
      }
      const number = Number(event.key)
      if (Number.isInteger(number) && number >= 1 && number <= currentPlayer.handCards.length) {
        const selected = toggleCard(number - 1)
        soundEngine.cardSelect({ selected })
        event.preventDefault()
        return
      }
      if (event.key === 'Enter' && selectedCount === 2) {
        event.preventDefault()
        handleConfirmSelection()
        return
      }
      if (event.key === 'Escape' && selectedCount > 0) {
        clearSelection()
        soundEngine.cardSelect({ selected: false })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSelfSelecting, loading, currentPlayer, selectedCount, toggleCard, clearSelection, handleConfirmSelection])

  const handlePlayAgain = async () => {
    if (!currentRoom) {
      return
    }

    setLoading(true)
    try {
      const nextGameState = await restartGame(currentRoom.id)
      if (!nextGameState) {
        // 还有人没准备：等全员准备后服务端会推送新局
        soundEngine.chipClink()
        tapFeedback(10)
        return
      }
      clearSelection()
      clearFinalRevealDelayTimer()
      setPreFinalRoundAcknowledged(false)
      setFinalRevealConfirmed(false)
      setFinalRevealReady(false)
      clearLatestRoundResult()
    } catch (error) {
      message.error(error.message || '重新开始失败')
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
    } catch (error) {
      message.error(error.message || '开始游戏失败')
    } finally {
      setLoading(false)
    }
  }

  const outcomeClass = (() => {
    if (!showdown || !user?.id) {
      return ''
    }
    const self = showdown.timeline.players.find((player) => player.playerId === user.id)
    if (!self) {
      return ''
    }
    return self.isLoser ? 'lose' : self.scoreDelta > 0 || showdown.timeline.isFinal ? 'win' : ''
  })()
  const outcomeOverlay = outcomeClass && !showdownDone ? (
    <div
      key={showdown.key}
      className={`outcome-vignette ${outcomeClass}`}
      style={{ animationDelay: `${Math.max(0, showdown.timeline.outcomeAt - (performance.now() - showdown.startedAt))}ms` }}
      aria-hidden="true"
    />
  ) : null

  if (finalScores) {
    if (finalStage === 'preFinal') {
      return (
        <>
          {outcomeOverlay}
          {showdownDone && (
            <RoundResultBar
              roundResult={preFinalRoundResult}
              currentPlayerId={user?.id || ''}
              continueText="进入终局"
              onContinue={() => {
                clearLatestRoundResult()
                setPreFinalRoundAcknowledged(true)
                scheduleFinalRevealDelay()
              }}
            />
          )}
        </>
      )
    }

    if (finalStage === 'waiting') {
      return (
        <div className="hud-floating-note is-large">
          <strong>准备比牌</strong>
          <span>第 {maxRounds} 轮即将开始，三家底牌将依次翻开</span>
        </div>
      )
    }

    if (finalStage === 'finalReveal') {
      return (
        <>
          {outcomeOverlay}
          {!showdownDone && <div className="hud-floating-note">终局摊牌 · 点击任意处跳过</div>}
          {showdownDone && (
            <FinalRoundRevealStage
              roundResult={finalRevealResult}
              onConfirm={() => {
                soundEngine.uiClick()
                setFinalRevealConfirmed(true)
                clearFinalRevealDelayTimer()
                clearLatestRoundResult()
              }}
            />
          )}
        </>
      )
    }

    const restartReadyIds = Array.isArray(currentRoom?.restartReadyIds) ? currentRoom.restartReadyIds : []
    const roomPlayerCount = currentRoom?.players?.length || 0
    const selfReady = restartReadyIds.includes(user?.id)
    const readyCount = restartReadyIds.length
    const historyResults = gameState?.roundResults?.length ? gameState.roundResults : (finalRoundResults || [])
    return (
      <div className="hud-result-shell is-podium">
        <Suspense fallback={<div className="hud-loader">正在加载结算面板…</div>}>
          <GameResult
            finalScores={finalScores}
            roundResults={historyResults}
            currentPlayerId={user?.id || ''}
            readyIds={restartReadyIds}
            onBackToRoom={exitCurrentRoom}
            onPlayAgain={handlePlayAgain}
            playAgainDisabled={selfReady || loading || roomPlayerCount !== 3}
            playAgainText={
              roomPlayerCount !== 3
                ? '人数不足，无法再来一局'
                : selfReady
                  ? `已准备，等待其他玩家（${readyCount}/3）`
                  : `再来一局（${readyCount}/3 已准备）`
            }
          />
        </Suspense>
      </div>
    )
  }

  if (!gameState) {
    return (
      <Card className="hud-panel hud-center-card" variant="borderless">
        <ConnectionStatusBanner
          className="hud-stack-gap"
          gameAlert={gameAlert}
          onClose={clearGameAlert}
          isConnected={isConnected}
          isReconnecting={isReconnecting}
          reconnectAttempts={reconnectAttempts}
          reconnectNextRetryAt={reconnectNextRetryAt}
        />
        <Title level={3} className="hud-title">准备开始游戏</Title>
        <Text className="hud-subtitle">所有玩家都已就位，点击开始游戏</Text>
        <Space wrap style={{ marginTop: 16 }}>
          <Button
            type="primary"
            className="hud-cta"
            size="large"
            loading={loading}
            data-testid="start-game-button"
            onClick={handleStartGame}
            disabled={!isHost || currentRoom?.players?.length !== 3}
          >
            {!isHost ? '等待房主开始' : '开始游戏'}
          </Button>
          <Button size="large" icon={<ArrowLeftOutlined />} data-testid="leave-room-button" onClick={exitCurrentRoom}>
            离开房间
          </Button>
        </Space>
      </Card>
    )
  }

  const selectionTimeoutMs = Number(gameState.selectionTimeoutMs || currentRoom?.selectionTimeoutMs || 30000)
  const publicCards = Array.isArray(gameState.publicCards) ? gameState.publicCards : []
  const activePublicCard = selectionRequired && !isHiddenRound ? publicCards[currentRound - 1] || null : null
  const opponents = (gameState.players || []).filter((player) => player.id !== user?.id)
  const showdownRunning = Boolean(showdown) && !showdownDone

  return (
    <section className={`hud-game ${isCountdownWarning && isSelfSelecting ? 'is-urgent' : ''}`} aria-label="对局场景">
      <header className="hud-game-top">
        <div className="hud-panel hud-game-bar">
          <Button type="text" icon={<ArrowLeftOutlined />} data-testid="leave-room-button" onClick={exitCurrentRoom} aria-label="离开房间">
            <span className="hud-hide-narrow">离开</span>
          </Button>
          <div className="hud-round">
            <span className="hud-round-label" data-testid="round-indicator">第 {currentRound} / {maxRounds} 轮</span>
            <ol className="hud-round-pips" aria-hidden="true">
              {Array.from({ length: maxRounds }).map((_, index) => {
                const round = index + 1
                const state = round < currentRound ? 'done' : round === currentRound ? 'current' : 'todo'
                return (
                  <li key={round} className={`is-${state} ${round === hiddenPublicCardIndex + 1 ? 'is-hidden-round' : ''}`}>
                    {round}
                  </li>
                )
              })}
            </ol>
          </div>
          {countdownMs > 0 && (
            <CountdownRing remainingMs={countdownMs} totalMs={selectionTimeoutMs} warning={isCountdownWarning} />
          )}
          <div className="hud-game-bar-tools">
            <Button
              type="text"
              icon={<HistoryOutlined />}
              onClick={() => setShowRoundHistory((value) => !value)}
              aria-label={showRoundHistory ? '收起历史' : '回合历史'}
            />
          </div>
        </div>

        <div className="hud-status-pill" aria-live="polite">
          <span className="hud-status-text">{showdownRunning ? '翻牌中 · 点击任意处跳过' : actionText}</span>
          <span className="hud-phase-steps" aria-label="回合流程">
            {phaseSteps.map((step) => (
              <span key={step.key} className={`${step.active ? 'is-active' : ''} ${step.done ? 'is-done' : ''}`.trim()}>
                {step.label}
              </span>
            ))}
          </span>
          {isHiddenRound && selectionRequired && <Tag color="purple">暗牌</Tag>}
          {!selectionRequired && <Tag color="gold">终局</Tag>}
        </div>
      </header>

      <ConnectionStatusBanner
        className="hud-stack-gap hud-game-banner"
        gameAlert={gameAlert}
        onClose={clearGameAlert}
        isConnected={isConnected}
        isReconnecting={isReconnecting}
        reconnectAttempts={reconnectAttempts}
        reconnectNextRetryAt={reconnectNextRetryAt}
      />

      {showdownDone && latestRoundResult && (
        <RoundResultBar
          roundResult={latestRoundResult}
          currentPlayerId={user?.id || ''}
          autoDismissMs={RESULT_BAR_AUTO_DISMISS_MS}
          onContinue={clearLatestRoundResult}
        />
      )}

      {tableRoundCueVisible && !showdownRunning && (
        <div key={`round-cue-${gameState?.lastAction?.seq || currentRound}`} className="hud-round-cue" aria-hidden="true">
          <span>{!selectionRequired ? '终局亮牌' : `ROUND ${currentRound}`}</span>
          <strong>{!selectionRequired ? '底牌比大小' : isHiddenRound ? '暗牌回合' : `第 ${currentRound} 轮`}</strong>
        </div>
      )}

      {outcomeOverlay}
      {isCountdownWarning && isSelfSelecting && <div className="urgent-vignette" aria-hidden="true" />}

      <Scoreboard seatAssignments={seatAssignments} selectionRequired={selectionRequired} currentUserId={user?.id} />

      <CoachMarks />

      <div className="hud-social">
        <EmoteBar roomId={currentRoom?.id} opponents={opponents} />
      </div>

      {currentPlayer && (
        <footer className="hud-hand-dock">
          {isSelfSelecting ? (
            <>
              <HandPreview
                handCards={currentPlayer.handCards || []}
                selectedCards={selectedCards}
                publicCard={activePublicCard}
                isHiddenRound={isHiddenRound}
              />
              <Button
                type="primary"
                size="large"
                className="hud-cta hud-confirm"
                loading={loading}
                data-testid="confirm-selection-button"
                disabled={!canConfirmSelection}
                onClick={handleConfirmSelection}
              >
                确认出牌 ({selectedCards.length}/2)
              </Button>
            </>
          ) : !selectionRequired ? (
            <div className="hud-hand-hint">本轮无公牌，系统将直接按剩余 3 张手牌比大小</div>
          ) : (
            <div className="hud-hand-hint is-done">
              已出牌，{pendingSelectionCount > 0 ? `等待 ${pendingSelectionCount} 位玩家…` : '准备翻牌'}
            </div>
          )}
        </footer>
      )}

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
              <Button size="small" onClick={() => setShowRoundHistory(false)}>
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

      <audio ref={bgmAudioRef} src="/audio/game-bgm.wav" preload="auto" loop />
    </section>
  )
}

export default GameScene

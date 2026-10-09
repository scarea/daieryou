import React, { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import useGameStore from '../store/gameStore'
import useTableUiStore from './tableUiStore'
import PlayingCard, { CARD_HEIGHT, CARD_WIDTH } from './PlayingCard'
import Avatar3D from './Avatar3D'
import { ChipStack, CHIP_COLORS } from './CasinoRoom'
import { getCardName, getHandTypeName } from '../utils/cardUtils'
import soundEngine from '../audio/soundEngine'
import useSettingsStore, { QUALITY_PRESETS, effectiveQuality, tapFeedback } from '../settings/settingsStore'
import ShowdownEffects, { useTimelineFlag } from './ShowdownEffects'
import { EMOTES } from '../components/emotes'
import {
  DECK_POSITION,
  DISCARD_POSITION,
  FACE_DOWN,
  FACE_UP,
  SEATS,
  buildSeatAssignments,
  chipStackPosition,
  deckLayerPosition,
  opponentHandTransform,
  playSpotTransform,
  publicCardPosition,
  selfHandTransform,
} from './layout'

const DECK_FROM = { position: deckLayerPosition(12), rotation: FACE_DOWN }
const HIT_Z_RANGE = [19, 11]
const OVERLAY_Z_RANGE_EMOTE = [26, 25]
const RANK_LABELS = { 1: '头名', 2: '二游', 3: '末位' }
const BOT_DIFFICULTY_LABEL = { easy: '简单', normal: '标准', hard: '进阶' }

function getCardIdentity(card) {
  return card ? `${card.suit || 'joker'}-${card.rank}` : 'unknown'
}

function getHandCount(player) {
  return Array.isArray(player?.handCards) ? player.handCards.length : Number(player?.handCards || 0)
}

function getPlayedCount(player) {
  return Array.isArray(player?.playedCards) ? player.playedCards.length : Number(player?.playedCards || 0)
}

const DeckStack = ({ count }) => {
  const layers = Math.max(0, Math.min(18, Math.ceil(count / 2)))
  if (layers === 0) {
    return null
  }
  return (
    <group>
      <mesh position={[DECK_POSITION[0], DECK_POSITION[1] + (layers * 0.014) / 2, DECK_POSITION[2]]} castShadow receiveShadow>
        <boxGeometry args={[CARD_WIDTH - 0.02, layers * 0.014, CARD_HEIGHT - 0.02]} />
        <meshStandardMaterial color="#e9e1cc" roughness={0.8} />
      </mesh>
      <PlayingCard position={deckLayerPosition(layers)} rotation={FACE_DOWN} />
      <Html position={[DECK_POSITION[0] - 0.78, 0.05, DECK_POSITION[2]]} center zIndexRange={HIT_Z_RANGE} style={{ pointerEvents: 'none' }}>
        <div className="table-chip-label">牌堆 {count}</div>
      </Html>
    </group>
  )
}

const DiscardPile = ({ count }) => {
  const visible = Math.min(count, 24)
  const cards = useMemo(() => Array.from({ length: visible }).map((_, index) => ({
    dx: Math.sin(index * 91.7) * 0.12,
    dz: Math.cos(index * 47.3) * 0.12,
    spin: Math.sin(index * 13.1) * 0.9,
  })), [visible])

  return cards.map((item, index) => (
    <PlayingCard
      key={`discard-${index}`}
      position={[DISCARD_POSITION[0] + item.dx, DISCARD_POSITION[1] + index * 0.005, DISCARD_POSITION[2] + item.dz]}
      rotation={[Math.PI / 2, 0, item.spin]}
      from={{ position: [0, 0.2, 0.3], rotation: FACE_DOWN }}
      castShadow={false}
      speed={5}
    />
  ))
}

const hitCorners = [
  new THREE.Vector3(-CARD_WIDTH / 2, -CARD_HEIGHT / 2, 0),
  new THREE.Vector3(CARD_WIDTH / 2, -CARD_HEIGHT / 2, 0),
  new THREE.Vector3(CARD_WIDTH / 2, CARD_HEIGHT / 2, 0),
  new THREE.Vector3(-CARD_WIDTH / 2, CARD_HEIGHT / 2, 0),
]
const projectedCorner = new THREE.Vector3()
const projectedCenter = new THREE.Vector3()

// 手牌点击热区：每帧把牌的四个角投影到屏幕，生成一个贴合牌面的 2D 按钮
// （普通 DOM 按钮，键盘可聚焦，测试工具也能可靠定位）
const HandCardHitArea = ({ card, index, selected, disabled, onToggle, onHover }) => {
  const anchorRef = useRef()
  const buttonRef = useRef()
  const dragStartRef = useRef(null)
  const dragSelectedRef = useRef(false)
  const { camera, size } = useThree()

  useFrame(() => {
    const anchor = anchorRef.current
    const button = buttonRef.current
    if (!anchor || !button) {
      return
    }
    anchor.updateWorldMatrix(true, false)
    projectedCenter.setFromMatrixPosition(anchor.matrixWorld).project(camera)
    const centerX = (projectedCenter.x * 0.5 + 0.5) * size.width
    const centerY = (-projectedCenter.y * 0.5 + 0.5) * size.height
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    hitCorners.forEach((corner) => {
      projectedCorner.copy(corner).applyMatrix4(anchor.matrixWorld).project(camera)
      const x = (projectedCorner.x * 0.5 + 0.5) * size.width
      const y = (-projectedCorner.y * 0.5 + 0.5) * size.height
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    })
    // 只保留整数像素，避免亚像素抖动让元素一直被判定为“不稳定”
    button.style.left = `${Math.round(minX - centerX)}px`
    button.style.top = `${Math.round(minY - centerY)}px`
    button.style.width = `${Math.round(maxX - minX)}px`
    button.style.height = `${Math.round(maxY - minY)}px`
  })

  return (
    <group ref={anchorRef}>
      <Html zIndexRange={HIT_Z_RANGE} style={{ position: 'relative' }}>
        <button
          ref={buttonRef}
          type="button"
          className={`card-hit-area ${selected ? 'is-selected' : ''}`}
          data-testid={`hand-card-${index}`}
          aria-label={`第 ${index + 1} 张手牌 ${getCardName(card)}${selected ? '，已选中' : ''}`}
          aria-pressed={selected}
          disabled={disabled}
          onClick={() => {
            if (dragSelectedRef.current) {
              dragSelectedRef.current = false
              return
            }
            onToggle(index)
          }}
          onPointerDown={(event) => {
            dragStartRef.current = event.clientY
          }}
          onPointerUp={(event) => {
            // 向上拖动手牌 = 选中（不再触发随后的 click 反选）
            const start = dragStartRef.current
            dragStartRef.current = null
            if (start !== null && start - event.clientY > 28 && !selected && !disabled) {
              dragSelectedRef.current = true
              onToggle(index)
            }
          }}
          onPointerEnter={() => {
            onHover(index)
            if (!disabled) {
              soundEngine.cardHover()
            }
          }}
          onPointerLeave={() => onHover(null)}
          onFocus={() => onHover(index)}
          onBlur={() => onHover(null)}
        >
          <span className="card-content">{getCardName(card)}</span>
        </button>
      </Html>
    </group>
  )
}

const SeatLabel = ({ player, roomPlayer, isHost, status, scoreTotal }) => {
  const isBot = roomPlayer?.isBot === true || player?.isBot === true
  return (
    <div className={`seat-label status-${status.key}`}>
      <div className="seat-label-name">{player.username}</div>
      <div className="seat-label-tags">
        {isBot && <span className="seat-tag ai">AI·{BOT_DIFFICULTY_LABEL[roomPlayer?.botDifficulty] || '标准'}</span>}
        {isHost && <span className="seat-tag host">房主</span>}
        {roomPlayer?.online === false && <span className="seat-tag offline">离线</span>}
        {player.selectedByTimeout && <span className="seat-tag timeout">托管</span>}
      </div>
      <div className="seat-label-meta">
        <span className="seat-status-text">{status.label}</span>
        <span className={scoreTotal >= 0 ? 'seat-score gain' : 'seat-score loss'}>
          {scoreTotal >= 0 ? '+' : ''}{scoreTotal}
        </span>
      </div>
    </div>
  )
}

function getSeatStatus({ player, isSelf, isBot, selectionRequired, offline }) {
  if (offline) {
    return { key: 'offline', label: '重连中', avatar: 'offline' }
  }
  if (!selectionRequired) {
    return { key: 'final', label: '亮牌', avatar: 'idle' }
  }
  if (player.hasSelected) {
    return { key: 'played', label: player.selectedByTimeout ? '托管出牌' : '已出牌', avatar: 'played' }
  }
  if (isBot) {
    return { key: 'thinking', label: '思考中', avatar: 'thinking' }
  }
  if (isSelf) {
    return { key: 'turn', label: '轮到你', avatar: 'turn' }
  }
  return { key: 'waiting', label: '选牌中', avatar: 'thinking' }
}

const RevealBadge = ({ seat, result, isLoser, showdown, revealedAt }) => {
  const visible = useTimelineFlag(showdown, revealedAt)
  const base = SEATS[seat].play
  if (showdown && !visible) {
    return null
  }
  return (
    <Html position={[base[0], 0.35, base[2] + (seat === 'bottom' ? 0.75 : 0.85)]} center zIndexRange={HIT_Z_RANGE} style={{ pointerEvents: 'none' }}>
      <div className={`reveal-badge ${isLoser ? 'is-loser' : result.rank === 1 ? 'is-winner' : ''}`}>
        <strong>{isLoser ? '二游' : RANK_LABELS[result.rank] || `第${result.rank}名`}</strong>
        <span>{getHandTypeName(result.evaluation?.type)}</span>
        {Number.isFinite(result.scoreDelta) && (
          <em>{result.scoreDelta > 0 ? '+' : ''}{result.scoreDelta}</em>
        )}
      </div>
    </Html>
  )
}

// 按结算时间轴翻牌：先扣着落到出牌位，到点依次翻开
const RevealCards = ({ revealResult, seatByPlayerId, showdown }) => {
  if (!revealResult || !Array.isArray(revealResult.playerResults)) {
    return null
  }
  const loserIndexes = revealResult.loserIndexes
    || (revealResult.loserIndex >= 0 ? [revealResult.loserIndex] : [])
  const timelineByPlayer = new Map((showdown?.timeline?.players || []).map((entry) => [entry.playerId, entry]))

  return revealResult.playerResults.map((result, resultIndex) => {
    const seat = seatByPlayerId.get(result.playerId)
    if (!seat || !Array.isArray(result.hand)) {
      return null
    }
    const isLoser = loserIndexes.includes(result.playerIndex)
    const entry = timelineByPlayer.get(result.playerId)
    return (
      <group key={`reveal-${revealResult.round}-${result.playerId}`}>
        {result.hand.map((card, cardIndex) => {
          const target = playSpotTransform(seat, cardIndex, result.hand.length, { faceUp: true })
          const faceDown = playSpotTransform(seat, cardIndex, result.hand.length, { faceUp: false })
          const flipAt = entry ? showdown.startedAt + entry.flips[cardIndex] : null
          return (
            <PlayingCard
              key={`reveal-${revealResult.round}-${result.playerId}-${cardIndex}`}
              card={card}
              position={[target.position[0], target.position[1] + 0.01, target.position[2]]}
              rotation={target.rotation}
              from={{ position: [faceDown.position[0], faceDown.position[1] + 0.02, faceDown.position[2]], rotation: faceDown.rotation }}
              delay={entry ? 0 : 250 + (cardIndex * 3 + resultIndex) * 160}
              startAt={flipAt}
              glow={isLoser ? '#ef4444' : result.rank === 1 ? '#facc15' : null}
              speed={entry ? 11 : 6}
            />
          )
        })}
        <RevealBadge seat={seat} result={result} isLoser={isLoser} showdown={entry ? showdown : null} revealedAt={entry?.revealedAt} />
      </group>
    )
  })
}

const EmoteBubbles = ({ emotes, seatByPlayerId, usernameById }) => emotes.map((emote) => {
  const seat = seatByPlayerId.get(emote.fromId)
  const definition = EMOTES.find((item) => item.id === emote.emoteId)
  if (!seat || !definition) {
    return null
  }
  const anchor = seat === 'bottom' ? [0, 1.2, 1.7] : [SEATS[seat].avatar[0] * 0.92, 1.95, SEATS[seat].avatar[2]]
  const targetName = emote.targetId ? usernameById.get(emote.targetId) : null
  return (
    <Html key={emote.id} position={anchor} center zIndexRange={OVERLAY_Z_RANGE_EMOTE} style={{ pointerEvents: 'none' }}>
      <div className={`emote-bubble seat-${seat}`}>
        <span className="emote-icon">{definition.icon}</span>
        <span className="emote-text">{definition.text}</span>
        {targetName && <span className="emote-target">→ {targetName}</span>}
      </div>
    </Html>
  )
})

const GameTable3D = () => {
  const user = useGameStore((state) => state.user)
  const currentRoom = useGameStore((state) => state.currentRoom)
  const gameState = useGameStore((state) => state.gameState)
  const selectedCards = useTableUiStore((state) => state.selectedCards)
  const playingCardIndices = useTableUiStore((state) => state.playingCardIndices)
  const hoveredCardIndex = useTableUiStore((state) => state.hoveredCardIndex)
  const busy = useTableUiStore((state) => state.busy)
  const revealResult = useTableUiStore((state) => state.revealResult)
  const toggleCard = useTableUiStore((state) => state.toggleCard)
  const setHoveredCardIndex = useTableUiStore((state) => state.setHoveredCardIndex)
  const showdown = useTableUiStore((state) => state.showdown)
  const urgent = useTableUiStore((state) => state.urgent)
  const emotes = useTableUiStore((state) => state.emotes)
  const quality = useSettingsStore((state) => effectiveQuality(state.quality, state.qualityCap))
  const reducedMotion = useSettingsStore((state) => state.reducedMotion)
  const moodReached = useTimelineFlag(showdown, showdown?.timeline?.stampAt ?? showdown?.timeline?.outcomeAt)
  const showdownEnded = useTimelineFlag(showdown, showdown?.timeline?.endAt)
  // 结算演出期间把新手牌压低收起，露出桌面上的翻牌
  const handTucked = Boolean(showdown) && !showdownEnded

  if (!gameState || !Array.isArray(gameState.players)) {
    return null
  }

  const seatAssignments = buildSeatAssignments(gameState.players, user?.id)
  const seatByPlayerId = new Map(seatAssignments.map(({ player, seat }) => [player.id, seat]))
  const selectionRequired = gameState.selectionRequired !== false
  const currentRound = gameState.currentRound || 1
  const maxRounds = gameState.maxRounds || 5
  const publicCards = Array.isArray(gameState.publicCards) ? gameState.publicCards : []
  const hiddenPublicCardIndex = Number.isInteger(gameState.hiddenPublicCardIndex) ? gameState.hiddenPublicCardIndex : 3
  const activePublicIndex = selectionRequired ? Math.min(currentRound - 1, publicCards.length - 1) : -1
  const isFinalReveal = Number(revealResult?.round || 0) === maxRounds
  const totalPlayed = gameState.players.reduce((sum, player) => sum + getPlayedCount(player), 0)
  const gameKey = publicCards.map((card) => getCardIdentity(card)).join('|')

  const handleToggle = (index) => {
    const selected = toggleCard(index)
    soundEngine.cardSelect({ selected })
    tapFeedback(selected ? 10 : 6)
  }
  const moodByPlayerId = new Map(
    moodReached && showdown?.timeline
      ? showdown.timeline.players.map((entry) => [entry.playerId, entry.isLoser ? 'lose' : entry.scoreDelta > 0 ? 'win' : null])
      : [],
  )
  const usernameById = new Map(gameState.players.map((player) => [player.id, player.username]))
  const sparkleScale = QUALITY_PRESETS[quality]?.sparkles ?? 1

  return (
    <group key={gameKey}>
      <DeckStack count={Number(gameState.deck || 0)} />
      <DiscardPile count={totalPlayed} />

      {publicCards.map((card, index) => {
        const isHidden = index === hiddenPublicCardIndex
        const isActive = index === activePublicIndex
        const isUsed = selectionRequired ? index < activePublicIndex : true
        const [x, y, z] = publicCardPosition(index, publicCards.length)
        return (
          <group key={`public-${index}`}>
            <PlayingCard
              card={isHidden ? null : card}
              position={[x, y + (isActive ? 0.06 : 0), z + (isActive ? 0.12 : 0)]}
              rotation={isHidden || !card ? FACE_DOWN : FACE_UP}
              from={DECK_FROM}
              delay={index * 110}
              glow={isActive ? (isHidden ? '#a855f7' : '#facc15') : null}
              dimmed={isUsed && !isActive}
            />
            <Html position={[x, 0.02, z - 0.72]} center zIndexRange={HIT_Z_RANGE} style={{ pointerEvents: 'none' }}>
              <div className={`public-slot-label ${isActive ? 'is-active' : ''}`}>
                {isHidden ? `第${index + 1}轮 · 暗` : `第${index + 1}轮`}
              </div>
            </Html>
          </group>
        )
      })}

      {seatAssignments.map(({ player, seat }, seatIndex) => {
        const isSelf = player.id === user?.id
        const roomPlayer = currentRoom?.players?.find((item) => item.id === player.id)
        const isBot = roomPlayer?.isBot === true || player.isBot === true
        const offline = roomPlayer?.online === false
        const status = getSeatStatus({ player, isSelf, isBot, selectionRequired, offline })
        const scoreTotal = Number(player.totalScore || 0)
        const seatConfig = SEATS[seat]
        const handCount = getHandCount(player)
        const showHand = !isFinalReveal
        const chipPosition = chipStackPosition(seat)

        let handNodes = null
        if (showHand && isSelf && Array.isArray(player.handCards)) {
          const serverSelected = player.hasSelected && Array.isArray(player.selectedCards) ? player.selectedCards : []
          const playedIndexes = serverSelected.length > 0 ? serverSelected : playingCardIndices
          const inHandIndexes = player.handCards.map((_, index) => index).filter((index) => !playedIndexes.includes(index))
          const handDisabled = player.hasSelected || busy || !selectionRequired || playingCardIndices.length > 0

          handNodes = player.handCards.map((card, index) => {
            const playedSlot = playedIndexes.indexOf(index)
            const key = `self-${getCardIdentity(card)}`
            if (playedSlot >= 0) {
              const target = playSpotTransform('bottom', playedSlot, playedIndexes.length, { faceUp: true })
              return (
                <PlayingCard key={key} card={card} position={target.position} rotation={target.rotation} speed={6} />
              )
            }
            const slot = inHandIndexes.indexOf(index)
            const selected = selectedCards.includes(index)
            const transform = selfHandTransform(slot, inHandIndexes.length, {
              lifted: selected,
              hovered: hoveredCardIndex === index && !handDisabled,
            })
            if (handTucked) {
              transform.position = [transform.position[0] * 0.8, transform.position[1] - 0.55, transform.position[2] + 0.75]
              transform.rotation = [transform.rotation[0] - 0.35, transform.rotation[1], transform.rotation[2]]
            }
            return (
              <PlayingCard
                key={key}
                card={card}
                position={transform.position}
                rotation={transform.rotation}
                from={DECK_FROM}
                delay={slot * 90}
                glow={selected ? '#facc15' : null}
                dimmed={handDisabled && !selected && selectionRequired}
                wobble={urgent && !handDisabled && !reducedMotion ? 0.02 : 0}
                speed={9}
              >
                <HandCardHitArea
                  card={card}
                  index={index}
                  selected={selected}
                  disabled={handDisabled}
                  onToggle={handleToggle}
                  onHover={setHoveredCardIndex}
                />
              </PlayingCard>
            )
          })
        } else if (showHand && !isSelf) {
          const playedCount = player.hasSelected && selectionRequired ? Math.min(2, handCount) : 0
          const fanCount = handCount - playedCount
          const fanNodes = Array.from({ length: fanCount }).map((_, index) => {
            const transform = opponentHandTransform(seat, index, fanCount)
            return (
              <PlayingCard
                key={`${seat}-h-${index}`}
                position={transform.position}
                rotation={transform.rotation}
                from={DECK_FROM}
                delay={seatIndex * 150 + index * 90}
              />
            )
          })
          const playNodes = Array.from({ length: playedCount }).map((_, index) => {
            const transform = playSpotTransform(seat, index, playedCount)
            const fromTransform = opponentHandTransform(seat, fanCount + index, handCount)
            return (
              <PlayingCard
                key={`${seat}-p-${index}`}
                position={transform.position}
                rotation={transform.rotation}
                from={fromTransform}
                speed={6}
              />
            )
          })
          handNodes = [...fanNodes, ...playNodes]
        }

        return (
          <group key={`seat-${player.id}`}>
            {!isSelf && (
              <Avatar3D
                position={seatConfig.avatar}
                facing={seatConfig.facing}
                color={seatConfig.color}
                isBot={isBot}
                offline={offline}
                status={status.avatar}
                mood={moodByPlayerId.get(player.id) || null}
                thinking={status.key === 'thinking' || status.key === 'waiting'}
                label={(
                  <SeatLabel
                    player={player}
                    roomPlayer={roomPlayer}
                    isHost={player.id === currentRoom?.hostId}
                    status={status}
                    scoreTotal={scoreTotal}
                  />
                )}
              />
            )}
            <ChipStack
              position={chipPosition}
              count={Math.max(1, Math.min(16, 6 + scoreTotal))}
              color={CHIP_COLORS[seatIndex % CHIP_COLORS.length]}
              wobble={seatIndex}
            />
            {handNodes}
          </group>
        )
      })}

      <RevealCards revealResult={revealResult} seatByPlayerId={seatByPlayerId} showdown={showdown} />
      <ShowdownEffects
        showdown={showdown}
        seatByPlayerId={seatByPlayerId}
        sparkleScale={sparkleScale}
        reducedMotion={reducedMotion}
      />
      <EmoteBubbles emotes={emotes} seatByPlayerId={seatByPlayerId} usernameById={usernameById} />
    </group>
  )
}

export default GameTable3D

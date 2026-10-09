import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { AdaptiveDpr, Float, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import useGameStore from '../store/gameStore'
import CasinoRoom, { ChipStack, CHIP_COLORS } from './CasinoRoom'
import CameraRig from './CameraRig'
import PlayingCard from './PlayingCard'
import Avatar3D from './Avatar3D'
import GameTable3D from './GameTable3D'
import Podium3D from './Podium3D'
import useTableUiStore from './tableUiStore'
import useSettingsStore, { QUALITY_PRESETS } from '../settings/settingsStore'
import { FACE_DOWN, SEATS, SEAT_ORDER, buildSeatAssignments, deckLayerPosition } from './layout'

const SHOWCASE_CARDS = [
  { suit: 'spades', rank: 1 },
  { suit: null, rank: 15 },
  { suit: 'hearts', rank: 1 },
  { suit: 'diamonds', rank: 1 },
  { suit: 'clubs', rank: 13 },
]

const LoginShowcase = () => {
  const ringRef = useRef()
  useFrame((state) => {
    if (ringRef.current) {
      ringRef.current.rotation.y = state.clock.elapsedTime * 0.25
    }
  })
  return (
    <group>
      <group ref={ringRef} position={[0, 1.45, 0]}>
        {SHOWCASE_CARDS.map((card, index) => {
          const angle = (index / SHOWCASE_CARDS.length) * Math.PI * 2
          return (
            <Float key={index} speed={1.6} rotationIntensity={0.4} floatIntensity={0.6}>
              <group position={[Math.sin(angle) * 1.7, 0, Math.cos(angle) * 1.7]} rotation={[0, angle, 0]} scale={1.35}>
                <PlayingCard card={card} position={[0, 0, 0]} rotation={[0, 0, 0]} />
              </group>
            </Float>
          )
        })}
      </group>
      <Sparkles count={40} scale={[5, 2.5, 5]} position={[0, 1.4, 0]} size={4} speed={0.5} color="#facc15" />
      <ChipStack position={[-1.6, 0, 0.9]} count={9} color={CHIP_COLORS[0]} />
      <ChipStack position={[-1.25, 0, 1.25]} count={5} color={CHIP_COLORS[4]} wobble={2} />
      <ChipStack position={[1.7, 0, 0.7]} count={7} color={CHIP_COLORS[1]} wobble={3} />
    </group>
  )
}

const LobbyShowcase = () => {
  const spread = useMemo(() => SHOWCASE_CARDS.map((card, index) => ({
    card,
    position: [(index - 2) * 0.82, 0.012, 0.3],
    rotation: [-Math.PI / 2, 0, (index - 2) * 0.08],
  })), [])

  return (
    <group>
      {spread.map((item, index) => (
        <PlayingCard
          key={index}
          card={item.card}
          position={item.position}
          rotation={item.rotation}
          from={{ position: deckLayerPosition(10), rotation: FACE_DOWN }}
          delay={300 + index * 140}
        />
      ))}
      {Array.from({ length: 6 }).map((_, index) => (
        <PlayingCard
          key={`deck-${index}`}
          position={deckLayerPosition(index)}
          rotation={FACE_DOWN}
          castShadow={index === 5}
        />
      ))}
      <ChipStack position={[-2.1, 0, 0.6]} count={10} color={CHIP_COLORS[0]} />
      <ChipStack position={[-1.75, 0, 0.95]} count={6} color={CHIP_COLORS[3]} wobble={1} />
      <ChipStack position={[2.1, 0, 0.55]} count={8} color={CHIP_COLORS[1]} wobble={2} />
      <ChipStack position={[1.8, 0, -0.9]} count={4} color={CHIP_COLORS[4]} wobble={3} />
    </group>
  )
}

const RoomSeats = () => {
  const user = useGameStore((state) => state.user)
  const currentRoom = useGameStore((state) => state.currentRoom)
  const players = currentRoom?.players || []
  const assignments = buildSeatAssignments(players, user?.id)

  return (
    <group>
      {SEAT_ORDER.map((seat, index) => {
        const assignment = assignments.find((item) => item.seat === seat)
        const seatConfig = SEATS[seat]
        const player = assignment?.player
        if (!player) {
          return (
            <Avatar3D
              key={seat}
              position={seatConfig.avatar}
              facing={seatConfig.facing}
              ghost
              label={<div className="seat-label is-empty"><div className="seat-label-name">空位</div><div className="seat-label-meta">等待玩家加入</div></div>}
            />
          )
        }
        const isSelf = player.id === user?.id
        return (
          <Avatar3D
            key={seat}
            position={seatConfig.avatar}
            facing={seatConfig.facing}
            color={seatConfig.color}
            isBot={player.isBot === true}
            offline={player.online === false}
            status={player.online === false ? 'offline' : 'played'}
            label={(
              <div className={`seat-label ${isSelf ? 'is-self' : ''}`}>
                <div className="seat-label-name">{player.username}{isSelf ? ' · 你' : ''}</div>
                <div className="seat-label-tags">
                  {player.isBot === true && <span className="seat-tag ai">AI</span>}
                  {player.id === currentRoom?.hostId && <span className="seat-tag host">房主</span>}
                  {player.online === false && <span className="seat-tag offline">离线</span>}
                </div>
                <div className="seat-label-meta">
                  <span className="seat-status-text">{player.online === false ? '等待重连' : '已就位'}</span>
                </div>
              </div>
            )}
          />
        )
      })}
      {Array.from({ length: 6 }).map((_, index) => (
        <PlayingCard key={`deck-${index}`} position={deckLayerPosition(index)} rotation={FACE_DOWN} castShadow={index === 5} />
      ))}
      <ChipStack position={[0, 0, 0.2]} count={Math.max(1, players.length * 3)} color={CHIP_COLORS[4]} />
    </group>
  )
}

const ResultCelebration = () => (
  <group>
    <Sparkles count={120} scale={[7, 4, 5]} position={[0, 1.6, 0]} size={5} speed={0.8} color="#facc15" />
    <Sparkles count={60} scale={[7, 4, 5]} position={[0, 1.6, 0]} size={3} speed={0.6} color="#f472b6" />
  </group>
)

const LoadingCard = () => {
  const ref = useRef()
  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 2
    }
  })
  return (
    <group ref={ref} position={[0, 1.2, 0]} scale={1.5}>
      <PlayingCard card={{ suit: null, rank: 15 }} position={[0, 0, 0]} rotation={[0, 0, 0]} />
    </group>
  )
}

const ResultScene = ({ sparkleScale }) => {
  const podium = useTableUiStore((state) => state.podium)
  if (podium) {
    return (
      <>
        <Podium3D entries={podium} confettiCount={Math.round(160 * Math.max(sparkleScale, 0.3))} />
        {sparkleScale > 0 && <ResultCelebration />}
      </>
    )
  }
  return <GameTable3D />
}

const SceneContent = ({ mode, sparkleScale }) => {
  switch (mode) {
    case 'login':
      return <LoginShowcase />
    case 'lobby':
      return <LobbyShowcase />
    case 'room':
      return <RoomSeats />
    case 'game':
      return <GameTable3D />
    case 'result':
      return (
        <ResultScene sparkleScale={sparkleScale} />
      )
    default:
      return <LoadingCard />
  }
}

// 结算演出时压暗主灯；终局摊牌几乎熄灯，只留座位聚光
function useLampIntensity(mode) {
  const showdown = useTableUiStore((state) => state.showdown)
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!showdown) {
      setActive(false)
      return undefined
    }
    const remaining = showdown.startedAt + showdown.timeline.endAt - performance.now()
    if (remaining <= 0) {
      setActive(false)
      return undefined
    }
    setActive(true)
    const timer = window.setTimeout(() => setActive(false), remaining)
    return () => window.clearTimeout(timer)
  }, [showdown])

  if (mode === 'login') {
    return 0.8
  }
  if (active) {
    return showdown.timeline.isFinal ? 0.22 : 0.6
  }
  return 1
}

const WorldScene = ({ mode, preset, onReady }) => {
  const lampIntensity = useLampIntensity(mode)
  const podium = useTableUiStore((state) => state.podium)
  const readyRef = useRef(false)
  useFrame(() => {
    if (!readyRef.current) {
      readyRef.current = true
      onReady()
    }
  })
  return (
    <>
      <CameraRig mode={mode} />
      <CasinoRoom
        lampIntensity={lampIntensity}
        shadows={preset.shadows}
        backgroundTables={preset.backgroundTables}
        sparkleScale={preset.sparkles}
        showTable={!(mode === 'result' && podium)}
      >
        <SceneContent mode={mode} sparkleScale={preset.sparkles} />
      </CasinoRoom>
    </>
  )
}

const World = ({ mode = 'loading' }) => {
  const quality = useSettingsStore((state) => state.quality)
  const preset = QUALITY_PRESETS[quality] || QUALITY_PRESETS.high
  const [ready, setReady] = useState(false)

  return (
    <div className={`world-canvas ${ready ? 'is-ready' : ''}`} aria-hidden={mode !== 'game' && mode !== 'result'}>
      <Canvas
        key={preset.shadows ? 'shadows' : 'flat'}
        shadows={preset.shadows}
        dpr={preset.dpr}
        camera={{ fov: 42, near: 0.1, far: 60, position: [0, 3.2, 9.5] }}
        gl={{ antialias: quality !== 'low', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      >
        <color attach="background" args={['#07050a']} />
        <fog attach="fog" args={['#07050a', 12, 28]} />
        <Suspense fallback={null}>
          <WorldScene mode={mode} preset={preset} onReady={() => setReady(true)} />
        </Suspense>
        <AdaptiveDpr pixelated={false} />
      </Canvas>
      {!ready && <div className="world-loading">正在布置牌桌…</div>}
    </div>
  )
}

export default World

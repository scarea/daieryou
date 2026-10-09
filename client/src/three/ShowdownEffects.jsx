import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { SEATS, chipStackPosition } from './layout'
import { CHIP_COLORS } from './CasinoRoom'

const OVERLAY_Z_RANGE = [24, 20]

// spotLight 的 target 不在场景树里，需要手动设置并更新矩阵，否则灯永远指向原点
export const AimedSpotLight = React.forwardRef(({ aim, ...props }, forwardedRef) => {
  const localRef = useRef()
  const setRefs = (light) => {
    localRef.current = light
    if (typeof forwardedRef === 'function') {
      forwardedRef(light)
    } else if (forwardedRef) {
      forwardedRef.current = light
    }
  }
  useEffect(() => {
    const light = localRef.current
    if (light) {
      light.target.position.set(...aim)
      light.target.updateMatrixWorld()
    }
  }, [aim[0], aim[1], aim[2]])
  return <spotLight ref={setRefs} {...props} />
})
const BIG_HAND_LABELS = { leopard: '豹子！', straight_flush: '同花顺！' }

// 时间轴上某个时刻是否已到（基于 showdown.startedAt，跳过演出时立即为真）
export function useTimelineFlag(showdown, atMs) {
  const [reached, setReached] = useState(false)
  const startedAt = showdown?.startedAt

  useEffect(() => {
    if (!showdown || atMs === null || atMs === undefined) {
      setReached(false)
      return undefined
    }
    const remaining = startedAt + atMs - performance.now()
    if (remaining <= 0) {
      setReached(true)
      return undefined
    }
    setReached(false)
    const timer = window.setTimeout(() => setReached(true), remaining)
    return () => window.clearTimeout(timer)
  }, [showdown, startedAt, atMs])

  return reached
}

// 二游印章 + 红色聚光
const LoserStamp = ({ seat, showdown }) => {
  const visible = useTimelineFlag(showdown, showdown.timeline.stampAt)
  const lightRef = useRef()
  const play = SEATS[seat].play

  useFrame((_, delta) => {
    if (lightRef.current) {
      lightRef.current.intensity = THREE.MathUtils.damp(lightRef.current.intensity, visible ? 40 : 0, 6, Math.min(delta, 0.05))
    }
  })

  return (
    <group>
      <AimedSpotLight
        ref={lightRef}
        aim={[play[0], 0, play[2]]}
        position={[play[0], 3.2, play[2] + 0.4]}
        angle={0.32}
        penumbra={0.6}
        intensity={0}
        distance={8}
        color="#ff3b3b"
      />
      {visible && (
        <Html position={[play[0], 0.15, play[2]]} center zIndexRange={OVERLAY_Z_RANGE} style={{ pointerEvents: 'none' }}>
          <div className="showdown-stamp">二游</div>
        </Html>
      )}
    </group>
  )
}

// 赢家上方的暖金光
const WinnerGlow = ({ seat, showdown }) => {
  const visible = useTimelineFlag(showdown, showdown.timeline.outcomeAt)
  const lightRef = useRef()
  const play = SEATS[seat].play
  useFrame((_, delta) => {
    if (lightRef.current) {
      lightRef.current.intensity = THREE.MathUtils.damp(lightRef.current.intensity, visible ? 6 : 0, 4, Math.min(delta, 0.05))
    }
  })
  return <pointLight ref={lightRef} position={[play[0], 1.4, play[2]]} intensity={0} distance={3.5} color="#ffd27a" />
}

// 筹码从二游飞向赢家：沿抛物线、带旋转，依次起飞
const ChipFlight = ({ fromSeat, toSeat, count, startAt, color }) => {
  const groupRef = useRef()
  const from = useMemo(() => new THREE.Vector3(...chipStackPosition(fromSeat)).setY(0.35), [fromSeat])
  const to = useMemo(() => new THREE.Vector3(...chipStackPosition(toSeat)).setY(0.3), [toSeat])
  const control = useMemo(() => from.clone().lerp(to, 0.5).setY(1.6), [from, to])
  const chips = useMemo(() => Array.from({ length: count }, (_, index) => ({
    delay: index * 70,
    spin: 6 + Math.random() * 6,
    jitter: new THREE.Vector3((Math.random() - 0.5) * 0.12, index * 0.035, (Math.random() - 0.5) * 0.12),
  })), [count])
  const point = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const group = groupRef.current
    if (!group) {
      return
    }
    const now = performance.now()
    group.children.forEach((child, index) => {
      const chip = chips[index]
      const progress = THREE.MathUtils.clamp((now - startAt - chip.delay) / 650, 0, 1)
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2
      // 二次贝塞尔
      const inv = 1 - eased
      point.copy(from).multiplyScalar(inv * inv)
        .addScaledVector(control, 2 * inv * eased)
        .addScaledVector(to, eased * eased)
        .add(chip.jitter)
      child.position.copy(point)
      child.rotation.x = progress < 1 ? eased * chip.spin : 0
      child.visible = now >= startAt + chip.delay && progress < 1
    })
  })

  return (
    <group ref={groupRef}>
      {chips.map((_, index) => (
        <mesh key={index} visible={false} castShadow>
          <cylinderGeometry args={[0.15, 0.15, 0.04, 24]} />
          <meshStandardMaterial color={color} roughness={0.4} metalness={0.1} />
        </mesh>
      ))}
    </group>
  )
}

const ScoreFloater = ({ seat, delta, showdown }) => {
  const visible = useTimelineFlag(showdown, showdown.timeline.numbersAt)
  const play = SEATS[seat].play
  if (!visible || !delta) {
    return null
  }
  return (
    <Html position={[play[0], 0.9, play[2]]} center zIndexRange={OVERLAY_Z_RANGE} style={{ pointerEvents: 'none' }}>
      <div className={`score-floater ${delta > 0 ? 'gain' : 'loss'}`}>{delta > 0 ? '+' : ''}{delta}</div>
    </Html>
  )
}

const BigHandBurst = ({ seat, type, at, showdown, sparkleScale }) => {
  const visible = useTimelineFlag(showdown, at)
  const play = SEATS[seat].play
  if (!visible) {
    return null
  }
  return (
    <group position={[play[0], 0.4, play[2]]}>
      {sparkleScale > 0 && (
        <Sparkles count={Math.round(60 * sparkleScale)} scale={[1.8, 1.2, 1.4]} size={6} speed={1.6} color="#ffe08a" />
      )}
      <pointLight intensity={8} distance={3} color="#ffd27a" />
      <Html position={[0, 0.9, 0]} center zIndexRange={OVERLAY_Z_RANGE} style={{ pointerEvents: 'none' }}>
        <div className="big-hand-banner">{BIG_HAND_LABELS[type] || '大牌！'}</div>
      </Html>
    </group>
  )
}

// 终局：每个座位一束聚光，像舞台摊牌
const FinalSpotlights = ({ seats }) => (
  <group>
    {seats.map((seat) => {
      const play = SEATS[seat].play
      return (
        <AimedSpotLight
          key={seat}
          aim={[play[0], 0, play[2]]}
          position={[play[0] * 0.8, 4, play[2] + 1]}
          angle={0.3}
          penumbra={0.7}
          intensity={55}
          distance={9}
          color="#fff1d6"
        />
      )
    })}
  </group>
)

/**
 * 回合结算演出的 3D 部分：盖章、聚光、筹码飞行、飘字、大牌特效。
 * 翻牌本身由 GameTable3D 的 RevealCards 按同一份时间轴完成。
 */
const ShowdownEffects = ({ showdown, seatByPlayerId, sparkleScale = 1, reducedMotion = false }) => {
  if (!showdown?.timeline) {
    return null
  }
  const { timeline } = showdown
  const seatOf = (playerId) => seatByPlayerId.get(playerId)

  return (
    <group>
      {timeline.isFinal && <FinalSpotlights seats={timeline.players.map((player) => seatOf(player.playerId)).filter(Boolean)} />}

      {timeline.players.map((player) => {
        const seat = seatOf(player.playerId)
        if (!seat) {
          return null
        }
        return (
          <group key={player.playerId}>
            {player.isLoser && <LoserStamp seat={seat} showdown={showdown} />}
            {!player.isLoser && player.scoreDelta > 0 && <WinnerGlow seat={seat} showdown={showdown} />}
            <ScoreFloater seat={seat} delta={player.scoreDelta} showdown={showdown} />
          </group>
        )
      })}

      {!reducedMotion && timeline.transfers.map((transfer, index) => {
        const fromSeat = seatOf(transfer.fromId)
        const toSeat = seatOf(transfer.toId)
        if (!fromSeat || !toSeat) {
          return null
        }
        return (
          <ChipFlight
            key={`${transfer.fromId}-${transfer.toId}`}
            fromSeat={fromSeat}
            toSeat={toSeat}
            count={Math.min(12, Math.max(2, transfer.amount * 2))}
            startAt={showdown.startedAt + timeline.chipsAt + index * 180}
            color={CHIP_COLORS[index % CHIP_COLORS.length]}
          />
        )
      })}

      {timeline.bigHands.map((bigHand) => {
        const seat = seatOf(bigHand.playerId)
        return seat
          ? <BigHandBurst key={bigHand.playerId} seat={seat} type={bigHand.type} at={bigHand.at} showdown={showdown} sparkleScale={sparkleScale} />
          : null
      })}
    </group>
  )
}

export default ShowdownEffects

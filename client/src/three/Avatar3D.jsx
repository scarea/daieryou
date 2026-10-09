import React, { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'

const STATUS_COLORS = {
  played: '#22c55e',
  thinking: '#f59e0b',
  waiting: '#64748b',
  turn: '#facc15',
  offline: '#ef4444',
  winner: '#facc15',
  loser: '#ef4444',
  idle: '#38bdf8',
}

const LABEL_Z_RANGE = [18, 10]

const Chair = ({ ghost = false }) => {
  const material = (
    <meshStandardMaterial
      color={ghost ? '#94a3b8' : '#3a1210'}
      roughness={0.55}
      metalness={0.1}
      transparent={ghost}
      opacity={ghost ? 0.25 : 1}
    />
  )
  return (
    <group position={[0, 0, -0.15]}>
      <mesh position={[0, 0.85, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.9, 0.14, 0.85]} />
        {material}
      </mesh>
      <mesh position={[0, 1.45, -0.42]} castShadow>
        <boxGeometry args={[0.9, 1.15, 0.12]} />
        {material}
      </mesh>
      {[[-0.38, -0.36], [0.38, -0.36], [-0.38, 0.36], [0.38, 0.36]].map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, 0.4, z]} castShadow>
          <cylinderGeometry args={[0.035, 0.03, 0.8, 8]} />
          <meshStandardMaterial color="#d9a441" metalness={0.8} roughness={0.3} transparent={ghost} opacity={ghost ? 0.25 : 1} />
        </mesh>
      ))}
    </group>
  )
}

const ThinkingDots = ({ color }) => {
  const refs = [useRef(), useRef(), useRef()]
  useFrame((state) => {
    refs.forEach((ref, index) => {
      if (ref.current) {
        ref.current.position.y = Math.max(0, Math.sin(state.clock.elapsedTime * 5 - index * 0.7)) * 0.12
      }
    })
  })
  return (
    <group position={[0, 2.72, 0]}>
      {refs.map((ref, index) => (
        <mesh key={index} ref={ref} position={[(index - 1) * 0.16, 0, 0]}>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

const Legs = ({ color }) => (
  <group>
    {[-0.14, 0.14].map((x) => (
      <mesh key={x} position={[x, 0.55, 0]} castShadow>
        <capsuleGeometry args={[0.1, 0.62, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
    ))}
  </group>
)

const HumanFigure = ({ color, offline, armsRef }) => {
  const skin = '#f2c9a0'
  return (
    <group>
      <mesh position={[0, 1.38, 0]} castShadow>
        <capsuleGeometry args={[0.3, 0.42, 8, 20]} />
        <meshStandardMaterial color={color} roughness={0.6} transparent={offline} opacity={offline ? 0.45 : 1} />
      </mesh>
      <mesh position={[0, 1.78, 0]}>
        <cylinderGeometry args={[0.1, 0.12, 0.12, 12]} />
        <meshStandardMaterial color={skin} roughness={0.7} />
      </mesh>
      <group position={[0, 2.08, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.28, 32, 24]} />
          <meshStandardMaterial color={skin} roughness={0.65} transparent={offline} opacity={offline ? 0.45 : 1} />
        </mesh>
        <mesh position={[0, 0.1, -0.03]} scale={[1.06, 0.82, 1.06]}>
          <sphereGeometry args={[0.28, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#1f1513" roughness={0.8} />
        </mesh>
        {[-0.1, 0.1].map((x) => (
          <mesh key={x} position={[x, 0.01, 0.25]}>
            <sphereGeometry args={[0.035, 12, 12]} />
            <meshStandardMaterial color="#111827" roughness={0.2} />
          </mesh>
        ))}
      </group>
      <group ref={armsRef}>
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 0.3, 1.66, 0.05]} userData={{ side }}>
            <mesh position={[0, -0.16, 0.27]} rotation={[1.15, 0, side * -0.25]} castShadow>
              <capsuleGeometry args={[0.08, 0.5, 6, 12]} />
              <meshStandardMaterial color={color} roughness={0.6} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  )
}

const BotFigure = ({ color, offline, armsRef }) => {
  const visorRef = useRef()
  useFrame((state) => {
    if (visorRef.current) {
      visorRef.current.material.emissiveIntensity = 1.4 + Math.sin(state.clock.elapsedTime * 3) * 0.5
    }
  })
  return (
    <group>
      <mesh position={[0, 1.36, 0]} castShadow>
        <boxGeometry args={[0.62, 0.72, 0.46]} />
        <meshStandardMaterial color="#9aa6b8" metalness={0.75} roughness={0.28} transparent={offline} opacity={offline ? 0.45 : 1} />
      </mesh>
      <mesh position={[0, 1.4, 0.235]}>
        <boxGeometry args={[0.3, 0.2, 0.02]} />
        <meshStandardMaterial color="#0b1220" emissive={color} emissiveIntensity={0.6} />
      </mesh>
      <group position={[0, 2.06, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.56, 0.46, 0.48]} />
          <meshStandardMaterial color="#c7d0dc" metalness={0.7} roughness={0.25} />
        </mesh>
        <mesh ref={visorRef} position={[0, 0.02, 0.245]}>
          <boxGeometry args={[0.44, 0.13, 0.02]} />
          <meshStandardMaterial color="#05131a" emissive="#22d3ee" emissiveIntensity={1.4} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.36, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 0.26, 6]} />
          <meshStandardMaterial color="#64748b" metalness={0.8} />
        </mesh>
        <mesh position={[0, 0.5, 0]}>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      </group>
      <group ref={armsRef}>
        {[-1, 1].map((side) => (
          <group key={side} position={[side * 0.38, 1.66, 0.05]} userData={{ side }}>
            <mesh position={[0, -0.16, 0.25]} rotation={[1.15, 0, 0]} castShadow>
              <cylinderGeometry args={[0.06, 0.06, 0.55, 10]} />
              <meshStandardMaterial color="#7c8799" metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  )
}

const Crown = () => {
  const ref = useRef()
  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.8
    }
  })
  return (
    <group ref={ref} position={[0, 2.5, 0]}>
      <mesh>
        <cylinderGeometry args={[0.2, 0.22, 0.12, 24, 1, true]} />
        <meshStandardMaterial color="#facc15" metalness={0.9} roughness={0.2} side={THREE.DoubleSide} emissive="#a16207" emissiveIntensity={0.4} />
      </mesh>
      {Array.from({ length: 5 }).map((_, index) => {
        const angle = (index / 5) * Math.PI * 2
        return (
          <mesh key={index} position={[Math.cos(angle) * 0.2, 0.12, Math.sin(angle) * 0.2]}>
            <coneGeometry args={[0.05, 0.14, 8]} />
            <meshStandardMaterial color="#facc15" metalness={0.9} roughness={0.2} emissive="#a16207" emissiveIntensity={0.4} />
          </mesh>
        )
      })}
    </group>
  )
}

/**
 * 坐在牌桌边的角色。position 为脚下地面坐标，facing 为面向牌桌中心的朝向。
 */
const Avatar3D = ({
  position,
  facing = 0,
  color = '#38bdf8',
  isBot = false,
  offline = false,
  status = 'idle',
  thinking = false,
  ghost = false,
  showFigure = true,
  label = null,
  mood = null,
  standing = false,
  crowned = false,
  showStatusLight = true,
}) => {
  const bodyRef = useRef()
  const armsRef = useRef()
  const seed = useRef(Math.random() * 10)
  const statusColor = STATUS_COLORS[status] || STATUS_COLORS.idle

  useFrame((state, delta) => {
    if (!bodyRef.current) {
      return
    }
    const time = state.clock.elapsedTime + seed.current
    const dt = Math.min(delta, 1 / 20)
    const damp = THREE.MathUtils.damp
    const body = bodyRef.current
    let targetY = Math.sin(time * 1.6) * 0.012
    let targetPitch = 0
    let targetArm = 0
    if (mood === 'win') {
      // 赢家：轻快地跳 + 举手
      targetY = Math.abs(Math.sin(time * 6)) * 0.12
      targetArm = -2.3 + Math.sin(time * 8) * 0.25
    } else if (mood === 'lose') {
      // 二游：垂头丧气
      targetY = -0.08
      targetPitch = 0.32
    } else if (mood === 'cheer') {
      targetY = Math.abs(Math.sin(time * 4)) * 0.06
      targetArm = -1.6 + Math.sin(time * 5) * 0.3
    }
    body.position.y = damp(body.position.y, targetY, 10, dt)
    body.rotation.x = damp(body.rotation.x, targetPitch, 6, dt)
    body.rotation.y = Math.sin(time * 0.5) * 0.06
    if (armsRef.current) {
      armsRef.current.children.forEach((arm) => {
        arm.rotation.x = damp(arm.rotation.x, targetArm, 8, dt)
        arm.rotation.z = damp(arm.rotation.z, targetArm !== 0 ? arm.userData.side * -0.35 : 0, 8, dt)
      })
    }
  })

  return (
    <group position={position} rotation={[0, facing, 0]}>
      {!standing && <Chair ghost={ghost} />}
      {!ghost && showFigure && (
        <group ref={bodyRef} position={[0, standing ? -0.2 : 0, 0]}>
          {standing && <Legs color={isBot ? '#7c8799' : '#1f2937'} />}
          {isBot
            ? <BotFigure color={color} offline={offline} armsRef={armsRef} />
            : <HumanFigure color={color} offline={offline} armsRef={armsRef} />}
          {crowned && <Crown />}
        </group>
      )}
      {!ghost && showFigure && thinking && <ThinkingDots color={statusColor} />}

      {!ghost && showStatusLight && !standing && (
        <group position={[0, 1.57, 0.95]}>
          <mesh>
            <sphereGeometry args={[0.07, 16, 16]} />
            <meshBasicMaterial color={new THREE.Color(statusColor).multiplyScalar(1.6)} toneMapped={false} />
          </mesh>
          <pointLight color={statusColor} intensity={1.2} distance={1.4} />
        </group>
      )}

      {label && (
        <Html position={[0, showFigure && !ghost ? 2.95 : 2.2, 0.2]} center zIndexRange={LABEL_Z_RANGE} style={{ pointerEvents: 'none' }}>
          {label}
        </Html>
      )}
    </group>
  )
}

export default Avatar3D

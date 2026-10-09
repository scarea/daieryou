import React, { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import Avatar3D from './Avatar3D'
import { AimedSpotLight } from './ShowdownEffects'
import { FLOOR_Y, SEATS } from './layout'

const PODIUM_Z = -3.4
// 名次 → 位置与台高：冠军居中最高
const PLACES = [
  { x: 0, height: 1.25, label: '1' },
  { x: -1.55, height: 0.85, label: '2' },
  { x: 1.55, height: 0.55, label: '3' },
]
const CONFETTI_COLORS = ['#facc15', '#f472b6', '#38bdf8', '#4ade80', '#fb923c', '#f8fafc']

// 彩带：实例化的小纸片，循环飘落
export const Confetti = ({ count = 160, area = [7, 6, 4], center = [0, 0, -2] }) => {
  const meshRef = useRef()
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const pieces = useMemo(() => Array.from({ length: count }, () => ({
    x: (Math.random() - 0.5) * area[0],
    y: Math.random() * area[1],
    z: (Math.random() - 0.5) * area[2],
    speed: 0.6 + Math.random() * 0.9,
    spin: Math.random() * 6,
    sway: Math.random() * Math.PI * 2,
  })), [count, area])
  const colors = useMemo(() => {
    const array = new Float32Array(count * 3)
    const color = new THREE.Color()
    for (let index = 0; index < count; index += 1) {
      color.set(CONFETTI_COLORS[index % CONFETTI_COLORS.length])
      color.toArray(array, index * 3)
    }
    return array
  }, [count])

  useFrame((state, delta) => {
    const mesh = meshRef.current
    if (!mesh) {
      return
    }
    const dt = Math.min(delta, 1 / 20)
    pieces.forEach((piece, index) => {
      piece.y -= piece.speed * dt
      if (piece.y < -1) {
        piece.y = area[1]
      }
      const time = state.clock.elapsedTime
      dummy.position.set(
        center[0] + piece.x + Math.sin(time * 1.3 + piece.sway) * 0.25,
        center[1] + piece.y,
        center[2] + piece.z,
      )
      dummy.rotation.set(time * piece.spin, time * piece.spin * 0.7, piece.sway)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]}>
      <planeGeometry args={[0.07, 0.11]}>
        <instancedBufferAttribute attach="attributes-color" args={[colors, 3]} />
      </planeGeometry>
      <meshBasicMaterial vertexColors side={THREE.DoubleSide} toneMapped={false} />
    </instancedMesh>
  )
}

/**
 * 终局领奖台：三位玩家站上 1/2/3 名台阶，冠军戴皇冠。
 * entries 已按名次排序：[{ playerId, username, totalScore, isBot, seat, isSelf }]
 */
const Podium3D = ({ entries = [], confettiCount = 160 }) => {
  const groupRef = useRef()
  const riseRef = useRef(0)

  // 台子从地下升起
  useFrame((_, delta) => {
    riseRef.current = THREE.MathUtils.damp(riseRef.current, 1, 2.2, Math.min(delta, 1 / 20))
    if (groupRef.current) {
      groupRef.current.position.y = (riseRef.current - 1) * 2.5
    }
  })

  return (
    <group>
      <group ref={groupRef}>
        {entries.slice(0, 3).map((entry, index) => {
          const place = PLACES[index]
          const color = SEATS[entry.seat]?.color || '#d9a441'
          return (
            <group key={entry.playerId} position={[place.x, FLOOR_Y, PODIUM_Z]}>
              <mesh position={[0, place.height / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[1.35, place.height, 1.1]} />
                <meshStandardMaterial color="#1c1018" roughness={0.35} metalness={0.4} />
              </mesh>
              <mesh position={[0, place.height + 0.005, 0]}>
                <boxGeometry args={[1.38, 0.02, 1.13]} />
                <meshStandardMaterial color="#d9a441" metalness={0.9} roughness={0.25} />
              </mesh>
              <Avatar3D
                position={[0, place.height, 0]}
                facing={0}
                color={color}
                isBot={entry.isBot}
                standing
                crowned={index === 0}
                mood={index === 0 ? 'win' : index === 1 ? 'cheer' : null}
                label={(
                  <div className={`podium-label place-${index + 1} ${entry.isSelf ? 'is-self' : ''}`}>
                    <span className="podium-place">{place.label}</span>
                    <strong>{entry.username}{entry.isSelf ? '（你）' : ''}</strong>
                    <em className={entry.totalScore >= 0 ? 'gain' : 'loss'}>
                      {entry.totalScore > 0 ? '+' : ''}{entry.totalScore}
                    </em>
                  </div>
                )}
              />
            </group>
          )
        })}
      </group>
      <AimedSpotLight aim={[0, FLOOR_Y + 1, PODIUM_Z]} position={[0, 5.5, -0.8]} angle={0.55} penumbra={0.6} intensity={110} distance={16} color="#fff1d6" />
      {confettiCount > 0 && <Confetti count={confettiCount} />}
      <Html position={[0, -1.2, PODIUM_Z + 0.7]} center zIndexRange={[18, 10]} style={{ pointerEvents: 'none' }}>
        <div className="podium-title">本局排名</div>
      </Html>
    </group>
  )
}

export default Podium3D

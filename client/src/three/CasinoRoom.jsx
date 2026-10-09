import React, { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { getFeltTexture, getFloorTexture, getWoodTexture } from './textures'
import { FLOOR_Y, TABLE_RADIUS_X, TABLE_RADIUS_Z, TABLE_SURFACE_Y } from './layout'

const CHIP_COLORS = ['#b91c1c', '#1d4ed8', '#15803d', '#111827', '#d9a441', '#7c3aed']

function createEllipseCurve(radiusX, radiusZ, y) {
  const points = []
  const segments = 96
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    points.push(new THREE.Vector3(Math.cos(angle) * radiusX, y, Math.sin(angle) * radiusZ))
  }
  return new THREE.CatmullRomCurve3(points, true)
}

export const ChipStack = ({ position, count = 6, color = '#b91c1c', wobble = 0 }) => {
  const chips = useMemo(() => Array.from({ length: count }).map((_, index) => ({
    y: index * 0.045,
    x: (Math.sin(index * 12.9898 + wobble) * 0.5) * 0.012,
    z: (Math.cos(index * 78.233 + wobble) * 0.5) * 0.012,
  })), [count, wobble])

  return (
    <group position={position}>
      {chips.map((chip, index) => (
        <group key={index} position={[chip.x, chip.y + 0.0225, chip.z]}>
          <mesh castShadow receiveShadow>
            <cylinderGeometry args={[0.15, 0.15, 0.04, 28]} />
            <meshStandardMaterial color={color} roughness={0.42} metalness={0.1} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.108, 0.008, 6, 28]} />
            <meshStandardMaterial color="#f8f1e0" roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

const PokerTable = () => {
  const feltTexture = getFeltTexture()
  const woodTexture = getWoodTexture()
  const rimCurve = useMemo(
    () => createEllipseCurve(TABLE_RADIUS_X + 0.1, TABLE_RADIUS_Z + 0.1, TABLE_SURFACE_Y + 0.02),
    [],
  )
  const inlayCurve = useMemo(
    () => createEllipseCurve(TABLE_RADIUS_X - 0.06, TABLE_RADIUS_Z - 0.06, TABLE_SURFACE_Y + 0.004),
    [],
  )

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[TABLE_RADIUS_X, TABLE_RADIUS_Z, 1]} position={[0, TABLE_SURFACE_Y, 0]} receiveShadow>
        <circleGeometry args={[1, 96]} />
        <meshStandardMaterial map={feltTexture} roughness={0.95} metalness={0} />
      </mesh>
      <mesh>
        <tubeGeometry args={[inlayCurve, 160, 0.012, 6, true]} />
        <meshStandardMaterial color="#d9a441" metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh castShadow receiveShadow>
        <tubeGeometry args={[rimCurve, 200, 0.17, 20, true]} />
        <meshStandardMaterial map={woodTexture} roughness={0.38} metalness={0.15} color="#8a4a28" />
      </mesh>
      <mesh position={[0, TABLE_SURFACE_Y - 0.17, 0]} scale={[TABLE_RADIUS_X + 0.12, 1, TABLE_RADIUS_Z + 0.12]} castShadow>
        <cylinderGeometry args={[1, 0.94, 0.32, 96, 1, true]} />
        <meshStandardMaterial color="#2a130a" roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, (TABLE_SURFACE_Y - 0.3 + FLOOR_Y) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.55, 0.9, TABLE_SURFACE_Y - 0.3 - FLOOR_Y, 32]} />
        <meshStandardMaterial color="#1c0d07" roughness={0.5} metalness={0.2} />
      </mesh>
      <mesh position={[0, FLOOR_Y + 0.06, 0]} receiveShadow>
        <cylinderGeometry args={[1.5, 1.6, 0.12, 40]} />
        <meshStandardMaterial color="#1c0d07" roughness={0.45} metalness={0.3} />
      </mesh>
    </group>
  )
}

const PendantLamp = ({ position = [0, 4.2, 0], intensity = 1 }) => (
  <group position={position}>
    <mesh position={[0, 1.4, 0]}>
      <cylinderGeometry args={[0.012, 0.012, 2.8, 6]} />
      <meshStandardMaterial color="#1f1f1f" />
    </mesh>
    <mesh>
      <cylinderGeometry args={[0.35, 1.25, 0.6, 48, 1, true]} />
      <meshStandardMaterial color="#0d3b2c" roughness={0.4} metalness={0.4} side={THREE.DoubleSide} />
    </mesh>
    <mesh position={[0, -0.29, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[1.25, 0.025, 8, 64]} />
      <meshStandardMaterial color="#d9a441" metalness={0.9} roughness={0.25} />
    </mesh>
    <mesh position={[0, -0.12, 0]}>
      <sphereGeometry args={[0.16, 24, 16]} />
      <meshBasicMaterial color={new THREE.Color('#fff2d0').multiplyScalar(2.2 * intensity)} toneMapped={false} />
    </mesh>
  </group>
)

const BackgroundTable = ({ position, rotation = 0 }) => (
  <group position={position} rotation={[0, rotation, 0]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[2.4, 1.6, 1]}>
      <circleGeometry args={[1, 48]} />
      <meshStandardMaterial color="#0b3d2f" roughness={0.95} />
    </mesh>
    <mesh position={[0, -0.85, 0]}>
      <cylinderGeometry args={[0.4, 0.6, 1.5, 16]} />
      <meshStandardMaterial color="#160a05" />
    </mesh>
    <pointLight position={[0, 2.2, 0]} intensity={6} distance={6} color="#ffd9a0" />
    <mesh position={[0, 2.6, 0]}>
      <cylinderGeometry args={[0.2, 0.8, 0.4, 24, 1, true]} />
      <meshStandardMaterial color="#0d3b2c" emissive="#ffb35a" emissiveIntensity={0.15} side={THREE.DoubleSide} />
    </mesh>
  </group>
)

const AmbientDust = ({ count = 70 }) => {
  const ref = useRef()
  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.02
    }
  })
  return (
    <group ref={ref}>
      <Sparkles count={count} scale={[12, 6, 12]} position={[0, 2, 0]} size={2.2} speed={0.25} opacity={0.35} color="#ffd9a0" />
    </group>
  )
}

// 主灯：亮度平滑过渡到目标值（结算时压暗、终局几乎熄灯）
const MainLamp = ({ intensity, shadows }) => {
  const lightRef = useRef()
  useFrame((_, delta) => {
    if (lightRef.current) {
      lightRef.current.intensity = THREE.MathUtils.damp(lightRef.current.intensity, 140 * intensity, 3, Math.min(delta, 1 / 20))
    }
  })
  return (
    <spotLight
      ref={lightRef}
      position={[0, 6.5, 0.6]}
      angle={0.62}
      penumbra={0.65}
      intensity={140 * intensity}
      distance={18}
      decay={2}
      color="#ffe6c2"
      castShadow={shadows}
      shadow-mapSize-width={1024}
      shadow-mapSize-height={1024}
      shadow-bias={-0.0004}
      shadow-normalBias={0.02}
    />
  )
}

const CasinoRoom = ({ lampIntensity = 1, shadows = true, backgroundTables = true, sparkleScale = 1, showTable = true, children }) => {
  const floorTexture = getFloorTexture()
  // 竖屏镜头更陡，会被吊灯挡住，干脆不画灯罩（灯光保留）
  const portrait = useThree((state) => state.size.width < state.size.height * 0.9)

  return (
    <group>
      <ambientLight intensity={0.22} color="#b9c7ff" />
      <hemisphereLight args={['#ffe2b8', '#120a12', 0.35]} />
      <MainLamp intensity={lampIntensity} shadows={shadows} />
      <pointLight position={[-6, 3, 5]} intensity={18} distance={14} color="#3b82f6" />
      <pointLight position={[6, 3, -4]} intensity={14} distance={14} color="#ec4899" />

      {!portrait && showTable && <PendantLamp position={[0, 5.1, 0]} intensity={lampIntensity} />}
      {showTable && <PokerTable />}

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR_Y, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial map={floorTexture} roughness={0.92} />
      </mesh>

      {backgroundTables && (
        <>
          <BackgroundTable position={[-9, -0.2, -9]} rotation={0.4} />
          <BackgroundTable position={[9.5, -0.2, -8]} rotation={-0.5} />
          <BackgroundTable position={[0, -0.2, -15]} />
        </>
      )}

      {sparkleScale > 0 && <AmbientDust count={Math.round(70 * sparkleScale)} />}
      {children}
    </group>
  )
}

export { CHIP_COLORS }
export default CasinoRoom

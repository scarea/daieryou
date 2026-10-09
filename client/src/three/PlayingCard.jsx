import React, { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { getCardBackTexture, getCardFaceTexture } from './textures'

export const CARD_WIDTH = 0.7
export const CARD_HEIGHT = 0.98
export const CARD_THICKNESS = 0.012
const CARD_RADIUS = 0.06
const FACE_OFFSET = CARD_THICKNESS / 2 + 0.0006

function createRoundedRectShape(width, height, radius) {
  const x = -width / 2
  const y = -height / 2
  const shape = new THREE.Shape()
  shape.moveTo(x + radius, y)
  shape.lineTo(x + width - radius, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + radius)
  shape.lineTo(x + width, y + height - radius)
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  shape.lineTo(x + radius, y + height)
  shape.quadraticCurveTo(x, y + height, x, y + height - radius)
  shape.lineTo(x, y + radius)
  shape.quadraticCurveTo(x, y, x + radius, y)
  return shape
}

// ShapeGeometry 的 UV 是形状坐标，这里归一化到 0..1，让整张贴图正好铺满牌面
function normalizeUv(geometry, width, height) {
  const position = geometry.attributes.position
  const uv = geometry.attributes.uv
  for (let index = 0; index < position.count; index += 1) {
    uv.setXY(index, position.getX(index) / width + 0.5, position.getY(index) / height + 0.5)
  }
  uv.needsUpdate = true
  return geometry
}

const cardShape = createRoundedRectShape(CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS)
const sharedGeometry = {
  body: new THREE.ExtrudeGeometry(cardShape, { depth: CARD_THICKNESS, bevelEnabled: false, curveSegments: 6 })
    .translate(0, 0, -CARD_THICKNESS / 2),
  face: normalizeUv(new THREE.ShapeGeometry(cardShape, 6), CARD_WIDTH, CARD_HEIGHT),
  glow: normalizeUv(
    new THREE.ShapeGeometry(createRoundedRectShape(CARD_WIDTH + 0.12, CARD_HEIGHT + 0.12, CARD_RADIUS + 0.05), 6),
    CARD_WIDTH + 0.12,
    CARD_HEIGHT + 0.12,
  ),
}
const bodyMaterial = new THREE.MeshStandardMaterial({ color: '#efe7d4', roughness: 0.7 })

const damp = THREE.MathUtils.damp

/**
 * 一张有厚度的 3D 扑克牌。位置/朝向变化时会平滑飞过去（带一点抛物线），
 * 首次挂载时从 from 位置出发，可配合 delay 实现依次发牌。
 */
const PlayingCard = ({
  card = null,
  position = [0, 0, 0],
  rotation = [-Math.PI / 2, 0, 0],
  from = null,
  delay = 0,
  startAt = null,
  wobble = 0,
  glow = null,
  dimmed = false,
  speed = 7,
  castShadow = true,
  children,
}) => {
  const groupRef = useRef()
  const mountedAtRef = useRef(null)
  const seedRef = useRef(Math.random() * 10)
  const targetRef = useRef({ position, rotation })
  targetRef.current = { position, rotation }

  const faceTexture = card ? getCardFaceTexture(card) : null
  const backTexture = getCardBackTexture()
  const faceMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    map: faceTexture || backTexture,
    roughness: 0.48,
    metalness: 0.02,
  }), [faceTexture, backTexture])
  const backMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    map: backTexture,
    roughness: 0.42,
    metalness: 0.08,
  }), [backTexture])

  useLayoutEffect(() => {
    const tint = dimmed ? 0.45 : 1
    faceMaterial.color.setScalar(tint)
    backMaterial.color.setScalar(tint)
  }, [dimmed, faceMaterial, backMaterial])

  useLayoutEffect(() => () => {
    faceMaterial.dispose()
    backMaterial.dispose()
  }, [faceMaterial, backMaterial])

  useLayoutEffect(() => {
    const group = groupRef.current
    const start = from || targetRef.current
    group.position.set(...start.position)
    group.rotation.set(...start.rotation)
    mountedAtRef.current = null
    // 只在挂载时设置初始位姿
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((state, delta) => {
    const group = groupRef.current
    if (!group) {
      return
    }
    if (mountedAtRef.current === null) {
      mountedAtRef.current = state.clock.elapsedTime
    }
    if ((state.clock.elapsedTime - mountedAtRef.current) * 1000 < delay) {
      return
    }
    // startAt 是 performance.now() 时间戳：用于和结算时间轴严格对齐（跳过演出时可整体提前）
    if (startAt !== null && performance.now() < startAt) {
      return
    }

    const dt = Math.min(delta, 1 / 20)
    const [tx, ty, tz] = targetRef.current.position
    const [rx, ry, rz] = targetRef.current.rotation
    const distance = Math.hypot(tx - group.position.x, tz - group.position.z)
    const arc = Math.min(distance, 2) * 0.32

    group.position.x = damp(group.position.x, tx, speed, dt)
    group.position.y = damp(group.position.y, ty + arc, speed, dt)
    group.position.z = damp(group.position.z, tz, speed, dt)
    group.rotation.x = damp(group.rotation.x, rx, speed * 0.85, dt)
    group.rotation.y = damp(group.rotation.y, ry, speed * 0.85, dt)
    const tremor = wobble > 0 ? Math.sin(state.clock.elapsedTime * 38 + seedRef.current) * wobble : 0
    group.rotation.z = damp(group.rotation.z, rz + tremor, speed * 0.85, dt)
  })

  return (
    <group ref={groupRef}>
      <mesh geometry={sharedGeometry.body} material={bodyMaterial} castShadow={castShadow} receiveShadow />
      <mesh geometry={sharedGeometry.face} material={faceMaterial} position={[0, 0, FACE_OFFSET]} />
      <mesh
        geometry={sharedGeometry.face}
        material={backMaterial}
        position={[0, 0, -FACE_OFFSET]}
        rotation={[0, Math.PI, 0]}
      />
      {glow && (
        <mesh geometry={sharedGeometry.glow} position={[0, 0, -FACE_OFFSET - 0.002]} rotation={[0, Math.PI, 0]}>
          <meshBasicMaterial color={glow} transparent opacity={0.85} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {children}
    </group>
  )
}

export default PlayingCard

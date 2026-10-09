import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import useTableUiStore from './tableUiStore'
import useSettingsStore from '../settings/settingsStore'

// 每个场景一个机位；切换场景时镜头平滑飞过去
const CAMERA_POSES = {
  loading: { position: [0, 3.2, 9.5], target: [0, 0.4, 0], orbit: 0.08 },
  login: { position: [0, 2.6, 8.6], target: [0, 0.6, 0], orbit: 0.06 },
  lobby: { position: [0, 7.2, 7.2], target: [0, -0.2, 0], orbit: 0.035 },
  room: { position: [0, 5.4, 7.6], target: [0, 0, -0.2], orbit: 0 },
  game: { position: [0, 5.5, 4.9], target: [0, -0.5, 0.1], orbit: 0, parallax: 0 },
  result: { position: [0, 6.2, 4.6], target: [0, -0.4, -0.3], orbit: 0.03 },
  // 发牌开场：镜头扫向本轮公牌
  intro: { position: [0, 3.9, 3.1], target: [0, -0.3, -0.6], orbit: 0, parallax: 0, halfWidth: 3.2 },
  // 结算：稍微推近
  showdown: { position: [0, 5.2, 4.3], target: [0, -0.5, 0.15], orbit: 0, parallax: 0 },
  // 终局摊牌：压低机位，更有压迫感
  finalShowdown: { position: [0, 3.6, 5.4], target: [0, -0.2, 0], orbit: 0, parallax: 0 },
  // 领奖台
  // 领奖台偏左入镜，给右侧结算面板留出位置
  podium: { position: [1.5, 2.4, 4.8], target: [1.5, 0.6, -3.4], orbit: 0, halfWidth: 4.8 },
}

// 竖屏：更陡的俯视角，让纵向空间被牌桌填满
const PORTRAIT_POSES = {
  game: { position: [0, 7.2, 3.0], target: [0, -0.5, -0.1], orbit: 0, parallax: 0 },
  showdown: { position: [0, 7.0, 3.0], target: [0, -0.5, 0.1], orbit: 0, parallax: 0 },
  finalShowdown: { position: [0, 6.6, 3.6], target: [0, -0.4, 0.1], orbit: 0, parallax: 0 },
  result: { position: [0, 7.2, 3.4], target: [0, -0.5, 0.2], orbit: 0, parallax: 0 },
  room: { position: [0, 6.6, 5.2], target: [0, 0, 0], orbit: 0, halfWidth: 4.4 },
  podium: { position: [0, 0.9, 5.5], target: [0, -1.6, -3.4], orbit: 0, halfWidth: 2.4 },
}

const lookTarget = new THREE.Vector3()
const desiredPosition = new THREE.Vector3()
const desiredTarget = new THREE.Vector3()

const CameraRig = ({ mode = 'loading' }) => {
  const { camera, size } = useThree()
  const currentTarget = useRef(new THREE.Vector3(0, 0.4, 0))

  useFrame((state, delta) => {
    const time = state.clock.elapsedTime
    const aspect = size.width / Math.max(size.height, 1)
    const portrait = aspect < 0.9
    const ui = useTableUiStore.getState()
    const reducedMotion = useSettingsStore.getState().reducedMotion
    const nowMs = performance.now()
    let poseName = mode
    if (mode === 'game' || mode === 'result') {
      const showdownActive = ui.showdown && nowMs - ui.showdown.startedAt < ui.showdown.timeline.endAt
      if (mode === 'result' && ui.podium) {
        poseName = 'podium'
      } else if (showdownActive) {
        poseName = ui.showdown.timeline.isFinal ? 'finalShowdown' : 'showdown'
      } else if (mode === 'game' && nowMs < ui.introUntil && !reducedMotion) {
        poseName = 'intro'
      }
    }
    const pose = (portrait && PORTRAIT_POSES[poseName]) || CAMERA_POSES[poseName] || CAMERA_POSES[mode] || CAMERA_POSES.loading
    const fov = portrait ? 50 : 42
    if (camera.fov !== fov) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }

    // 按水平视角计算需要的距离，保证牌桌（横屏时连同两侧座位）完整入镜
    desiredTarget.set(...pose.target)
    desiredPosition.set(...pose.position).sub(desiredTarget)
    const baseDistance = desiredPosition.length()
    const halfHorizontalFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect)
    const requiredDistance = (pose.halfWidth || (portrait ? 3.1 : 4.9)) / Math.tan(halfHorizontalFov)
    const pullBack = Math.min(2.4, Math.max(1, requiredDistance / baseDistance))
    desiredPosition.multiplyScalar(pullBack).add(desiredTarget)

    if (pose.orbit > 0 && !reducedMotion) {
      const radius = Math.hypot(desiredPosition.x, desiredPosition.z)
      const angle = Math.sin(time * pose.orbit) * 0.55
      desiredPosition.x = Math.sin(angle) * radius
      desiredPosition.z = Math.cos(angle) * radius
    }
    // 鼠标视差（对局中关闭，保证手牌位置稳定便于点选）
    const parallax = pose.parallax ?? 1
    desiredPosition.x += state.pointer.x * 0.35 * parallax
    desiredPosition.y += state.pointer.y * 0.18 * parallax

    // 盖章时轻微震屏
    if (nowMs < ui.shakeUntil && !reducedMotion) {
      const strength = (ui.shakeUntil - nowMs) / 260
      desiredPosition.x += (Math.random() - 0.5) * 0.14 * strength
      desiredPosition.y += (Math.random() - 0.5) * 0.1 * strength
    }

    const dt = Math.min(delta, 1 / 20)
    camera.position.x = THREE.MathUtils.damp(camera.position.x, desiredPosition.x, 2.4, dt)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, desiredPosition.y, 2.4, dt)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, desiredPosition.z, 2.4, dt)
    currentTarget.current.x = THREE.MathUtils.damp(currentTarget.current.x, desiredTarget.x, 2.4, dt)
    currentTarget.current.y = THREE.MathUtils.damp(currentTarget.current.y, desiredTarget.y, 2.4, dt)
    currentTarget.current.z = THREE.MathUtils.damp(currentTarget.current.z, desiredTarget.z, 2.4, dt)
    lookTarget.copy(currentTarget.current)
    camera.lookAt(lookTarget)
  })

  return null
}

export default CameraRig

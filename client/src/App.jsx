import React, { Suspense, lazy, useEffect, useState } from 'react'
import { ConfigProvider, theme as antdThemeAlgorithms } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import useGameStore from './store/gameStore'
import SettingsButton from './components/SettingsButton'
import soundEngine from './audio/soundEngine'
import './App.css'
import './ui3d.css'

const World = lazy(() => import('./three/World'))
const LoginScene = lazy(() => import('./scenes/LoginScene'))
const RoomScene = lazy(() => import('./scenes/RoomScene'))
const GameScene = lazy(() => import('./scenes/GameScene'))

const antdTheme = {
  algorithm: antdThemeAlgorithms.darkAlgorithm,
  token: {
    colorPrimary: '#d9a441',
    colorTextLightSolid: '#1b1406',
    colorError: '#ef4444',
    colorWarning: '#f59e0b',
    colorInfo: '#38bdf8',
    colorSuccess: '#22c55e',
    colorText: '#f6efe0',
    colorTextSecondary: '#c9bfa8',
    colorBgContainer: 'rgba(20, 16, 22, 0.72)',
    colorBgElevated: '#17121a',
    colorBorder: 'rgba(217, 164, 65, 0.24)',
    colorBorderSecondary: 'rgba(217, 164, 65, 0.14)',
    borderRadius: 12,
    fontFamily: "'Space Grotesk', 'Noto Sans SC', 'PingFang SC', sans-serif",
  },
  components: {
    Button: {
      controlHeightLG: 46,
      borderRadiusLG: 14,
      fontWeight: 600,
    },
    Input: {
      controlHeightLG: 46,
      borderRadiusLG: 12,
    },
    Modal: {
      contentBg: '#17121a',
      headerBg: '#17121a',
    },
  },
}

// 3D 场景出错时只降级为静态背景，不影响游戏界面（HUD）本身
class WorldErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('3D 场景渲染失败，已降级为静态背景:', error)
  }

  render() {
    if (this.state.failed) {
      return <div className="world-canvas world-canvas-fallback" />
    }
    return this.props.children
  }
}

const SceneLoader = ({ title = '加载中…' }) => (
  <div className="hud-loader" aria-live="polite">{title}</div>
)

// 免费服务器休眠后的首次访问：显示唤醒进度，避免玩家以为页面卡死
const ServerWakeNotice = () => {
  const serverWakeStatus = useGameStore((state) => state.serverWakeStatus)
  const serverWakeStartedAt = useGameStore((state) => state.serverWakeStartedAt)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (serverWakeStatus !== 'waking') {
      return undefined
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [serverWakeStatus])

  if (serverWakeStatus === 'waking') {
    const seconds = Math.max(0, Math.round((now - (serverWakeStartedAt || now)) / 1000))
    return (
      <div className="server-wake-notice" role="status" aria-live="polite">
        <strong>正在唤醒牌桌服务器… {seconds}s</strong>
        <span>服务器空闲时会休眠，首次进入大约需要 1 分钟，请稍候</span>
      </div>
    )
  }
  if (serverWakeStatus === 'failed') {
    return (
      <div className="server-wake-notice is-failed" role="alert">
        <strong>服务器暂时无法连接</strong>
        <span>请稍后刷新页面重试</span>
      </div>
    )
  }
  return null
}

function resolveSceneMode({ bootstrapStatus, isLoggedIn, currentRoom, gameState, finalScores }) {
  if (bootstrapStatus !== 'ready') {
    return 'loading'
  }
  if (!isLoggedIn) {
    return 'login'
  }
  if (currentRoom && (gameState || finalScores)) {
    return finalScores ? 'result' : 'game'
  }
  return currentRoom ? 'room' : 'lobby'
}

function App() {
  const { bootstrap, bootstrapStatus, isLoggedIn, currentRoom, gameState, finalScores } = useGameStore()

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  // 环境底噪（房间声、远处筹码声）全局常驻，音量由设置控制
  useEffect(() => {
    soundEngine.setAmbience(true)
    // 所有按钮统一一声轻柔的木质点击（手牌有自己的纸牌声）
    const handlePointerDown = (event) => {
      const button = event.target?.closest?.('button, [role="tab"], .ant-select-selector, .ant-segmented-item')
      if (button && !button.closest('.card-hit-area') && !button.disabled) {
        soundEngine.uiClick()
      }
    }
    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  const mode = resolveSceneMode({ bootstrapStatus, isLoggedIn, currentRoom, gameState, finalScores })
  let sceneNode = <SceneLoader />
  if (mode === 'login') {
    sceneNode = <LoginScene />
  } else if (mode === 'game' || mode === 'result') {
    sceneNode = <GameScene />
  } else if (mode === 'lobby' || mode === 'room') {
    sceneNode = <RoomScene />
  }

  return (
    <ConfigProvider locale={zhCN} theme={antdTheme}>
      <div className={`app3d app3d-mode-${mode}`}>
        <WorldErrorBoundary>
          <Suspense fallback={<div className="world-canvas world-canvas-fallback" />}>
            <World mode={mode} />
          </Suspense>
        </WorldErrorBoundary>
        <main className="hud-layer">
          <Suspense fallback={<SceneLoader title="正在加载场景…" />}>
            {sceneNode}
          </Suspense>
        </main>
        <ServerWakeNotice />
        <SettingsButton />
      </div>
    </ConfigProvider>
  )
}

export default App

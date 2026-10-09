import React, { Suspense, lazy, useEffect } from 'react'
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

const SceneLoader = ({ title = '加载中…' }) => (
  <div className="hud-loader" aria-live="polite">{title}</div>
)

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
        <Suspense fallback={<div className="world-canvas world-canvas-fallback" />}>
          <World mode={mode} />
        </Suspense>
        <main className="hud-layer">
          <Suspense fallback={<SceneLoader title="正在加载场景…" />}>
            {sceneNode}
          </Suspense>
        </main>
        <SettingsButton />
      </div>
    </ConfigProvider>
  )
}

export default App

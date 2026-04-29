import React, { Suspense, lazy, useEffect } from 'react'
import { ConfigProvider, Typography } from 'antd'
const { Title } = Typography
import zhCN from 'antd/locale/zh_CN'
import useGameStore from './store/gameStore'
import './App.css'

const LoginScene = lazy(() => import('./scenes/LoginScene'))
const RoomScene = lazy(() => import('./scenes/RoomScene'))
const GameScene = lazy(() => import('./scenes/GameScene'))

const antdTheme = {
  token: {
    colorPrimary: '#14b8a6',
    colorError: '#ef4444',
    colorWarning: '#f59e0b',
    colorInfo: '#38bdf8',
    colorSuccess: '#22c55e',
    colorText: '#ecfeff',
    colorTextSecondary: '#a7f3d0',
    colorBgContainer: 'rgba(8, 28, 39, 0.84)',
    colorBgElevated: 'rgba(7, 23, 35, 0.96)',
    colorBorder: 'rgba(148, 163, 184, 0.22)',
    borderRadius: 14,
    fontFamily: "'Space Grotesk', 'Noto Sans SC', 'PingFang SC', sans-serif",
  },
  components: {
    Button: {
      controlHeightLG: 46,
      borderRadiusLG: 14,
      fontWeight: 600,
    },
    Card: {
      borderRadiusLG: 20,
    },
    Input: {
      controlHeightLG: 46,
      borderRadiusLG: 14,
    },
    Alert: {
      borderRadiusLG: 14,
    },
  },
}

const SceneLoader = ({ title = '加载中...' }) => (
  <div className="scene-loader" aria-live="polite">
    <Title level={3} className="scene-hero-title">{title}</Title>
  </div>
)

function App() {
  const { bootstrap, bootstrapStatus, isLoggedIn, currentRoom, gameState, finalScores } = useGameStore()

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  let sceneName = 'loading'
  let sceneNode = <SceneLoader />

  if (bootstrapStatus === 'ready' && !isLoggedIn) {
    sceneName = 'login'
    sceneNode = <LoginScene />
  } else if (bootstrapStatus === 'ready') {
    const inGame = Boolean(currentRoom && (gameState || finalScores))
    sceneName = inGame ? (finalScores ? 'result' : 'game') : 'lobby'
    sceneNode = inGame ? <GameScene /> : <RoomScene />
  }

  return (
    <ConfigProvider locale={zhCN} theme={antdTheme}>
      <div className={`App app-scene-${sceneName}`}>
        <Suspense fallback={<SceneLoader title="正在加载场景..." />}>
          {sceneNode}
        </Suspense>
      </div>
    </ConfigProvider>
  )
}

export default App

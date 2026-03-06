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
    colorPrimary: '#0f8a7a',
    colorError: '#c8452d',
    colorWarning: '#d17a29',
    colorInfo: '#1c83b1',
    borderRadius: 12,
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

import React, { useEffect, useState } from 'react'
import { Alert, Space, Tag, Typography } from 'antd'

const { Text } = Typography

const ConnectionStatusBanner = ({
  gameAlert,
  isConnected,
  isReconnecting,
  reconnectAttempts = 0,
  reconnectNextRetryAt = null,
  onClose,
  className = '',
}) => {
  const [countdownMs, setCountdownMs] = useState(0)

  useEffect(() => {
    if (!isReconnecting || !reconnectNextRetryAt) {
      setCountdownMs(0)
      return undefined
    }

    const updateCountdown = () => {
      setCountdownMs(Math.max(0, reconnectNextRetryAt - Date.now()))
    }

    updateCountdown()
    const timer = window.setInterval(updateCountdown, 250)
    return () => {
      window.clearInterval(timer)
    }
  }, [isReconnecting, reconnectNextRetryAt])

  const shouldShow = Boolean(gameAlert) || isReconnecting || !isConnected
  if (!shouldShow) {
    return null
  }

  const countdownSeconds = Math.ceil(countdownMs / 1000)
  const retryAttempt = Math.max(1, reconnectAttempts)
  const title = gameAlert || '网络连接异常，系统正在尝试恢复'

  const description = (
    <Space size={[8, 8]} wrap>
      {isReconnecting && <Tag color="orange">第 {retryAttempt} 次重连</Tag>}
      {isReconnecting && countdownSeconds > 0 && (
        <Tag color="processing">预计 {countdownSeconds}s 后重试</Tag>
      )}
      <Text className="network-alert-text">保持页面开启可自动恢复到房间和对局</Text>
    </Space>
  )

  return (
    <Alert
      className={`network-alert ${className}`.trim()}
      type={isReconnecting || !isConnected ? 'warning' : 'info'}
      showIcon
      closable={Boolean(gameAlert)}
      message={title}
      description={description}
      onClose={onClose}
    />
  )
}

export default ConnectionStatusBanner

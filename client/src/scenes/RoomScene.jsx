import React, { useEffect, useState } from 'react'
import { Button, Card, Input, List, Modal, Space, Tag, Typography, message } from 'antd'
import { PlusOutlined, UserOutlined } from '@ant-design/icons'
import ConnectionStatusBanner from '../components/ConnectionStatusBanner'
import useGameStore from '../store/gameStore'

const { Title, Text } = Typography

const RoomScene = () => {
  const {
    user,
    accountInfo,
    authConfig,
    currentRoom,
    roomList,
    createRoom,
    createInviteCode,
    purchaseMembership,
    fetchAuthConfig,
    adminGrantMembership,
    adminListInviteCodes,
    adminDisableInviteCode,
    adminInviteCodes,
    joinRoom,
    leaveRoom,
    getRoomList,
    startGame,
    gameAlert,
    clearGameAlert,
    isConnected,
    isReconnecting,
    reconnectAttempts,
    reconnectNextRetryAt,
  } = useGameStore()

  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [memberLoading, setMemberLoading] = useState(false)
  const [adminGrantLoading, setAdminGrantLoading] = useState(false)
  const [adminInviteLoading, setAdminInviteLoading] = useState(false)
  const [adminTargetEmail, setAdminTargetEmail] = useState('')
  const [adminDurationDays, setAdminDurationDays] = useState(String(authConfig?.memberDefaultDays || 30))
  const [adminReason, setAdminReason] = useState('')

  useEffect(() => {
    if (!currentRoom && roomList.length === 0) {
      handleRefreshRooms()
    }
  }, [currentRoom])

  useEffect(() => {
    if (accountInfo?.isAdmin === true && adminInviteCodes.length === 0) {
      adminListInviteCodes({
        limit: authConfig?.adminInviteListLimit,
      }).catch(() => {})
    }
  }, [accountInfo?.isAdmin, authConfig?.adminInviteListLimit, adminInviteCodes.length, adminListInviteCodes])

  useEffect(() => {
    const nextDefaultDays = String(authConfig?.memberDefaultDays || 30)
    if (!adminDurationDays || Number(adminDurationDays) <= 0) {
      setAdminDurationDays(nextDefaultDays)
    }
  }, [authConfig?.memberDefaultDays])

  const handleCreateRoom = async () => {
    setLoading(true)
    try {
      await createRoom()
      message.success('房间创建成功')
    } catch (error) {
      message.error(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleJoinRoom = async (roomId) => {
    setLoading(true)
    try {
      await joinRoom(roomId)
      message.success('加入房间成功')
    } catch (error) {
      message.error(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLeaveRoom = async () => {
    Modal.confirm({
      title: '确认离开房间？',
      content: '离开后需要重新加入',
      onOk: async () => {
        try {
          await leaveRoom()
          message.success('已离开房间')
        } catch (error) {
          message.error(error.message)
        }
      },
    })
  }

  const handleStartGame = async () => {
    if (!currentRoom) {
      return
    }

    setLoading(true)
    try {
      await startGame(currentRoom.id)
      message.success('游戏开始！')
    } catch (error) {
      message.error(error.message || '开始游戏失败')
    } finally {
      setLoading(false)
    }
  }

  const handleRefreshRooms = async () => {
    if (refreshing) {
      return
    }

    setRefreshing(true)
    try {
      await getRoomList()
    } catch (error) {
      console.error('刷新房间列表失败:', error)
    } finally {
      setRefreshing(false)
    }
  }

  const handleCreateInviteCode = async () => {
    setInviteLoading(true)
    try {
      const result = await createInviteCode()
      Modal.info({
        title: '邀请码已生成',
        content: (
          <div style={{ display: 'grid', gap: 8 }}>
            <div>邀请码：<strong>{result.code}</strong></div>
            <div>有效期至：{new Date(result.expiresAt).toLocaleString()}</div>
          </div>
        ),
      })
    } catch (error) {
      message.error(error.message || '生成邀请码失败')
    } finally {
      setInviteLoading(false)
    }
  }

  const handlePurchaseMembership = async () => {
    setMemberLoading(true)
    try {
      const result = await purchaseMembership(authConfig?.memberDefaultDays)
      await fetchAuthConfig()
      message.success(`会员已开通/续费，有效期至 ${new Date(result.expiresAt).toLocaleString()}`)
    } catch (error) {
      message.error(error.message || '会员开通失败')
    } finally {
      setMemberLoading(false)
    }
  }

  const handleAdminGrantMembership = async () => {
    const targetEmail = adminTargetEmail.trim().toLowerCase()
    if (!targetEmail) {
      message.error('请输入目标邮箱')
      return
    }

    const durationDays = Number(adminDurationDays)
    if (!Number.isFinite(durationDays) || durationDays <= 0) {
      message.error('请输入有效时长（天）')
      return
    }

    setAdminGrantLoading(true)
    try {
      const result = await adminGrantMembership({
        targetEmail,
        durationDays,
        reason: adminReason.trim(),
      })
      message.success(`已发放会员：${result.account?.email || targetEmail}`)
      setAdminTargetEmail('')
      setAdminReason('')
    } catch (error) {
      message.error(error.message || '发放会员失败')
    } finally {
      setAdminGrantLoading(false)
    }
  }

  const handleAdminListInviteCodes = async () => {
    setAdminInviteLoading(true)
    try {
      await adminListInviteCodes({
        limit: authConfig?.adminInviteListLimit,
      })
    } catch (error) {
      message.error(error.message || '加载邀请码列表失败')
    } finally {
      setAdminInviteLoading(false)
    }
  }

  const handleAdminDisableInviteCode = async (code) => {
    Modal.confirm({
      title: `禁用邀请码 ${code}？`,
      content: '禁用后该邀请码不可再被使用',
      onOk: async () => {
        try {
          await adminDisableInviteCode({ code, reason: 'manual-disable' })
          await handleAdminListInviteCodes()
          message.success('邀请码已禁用')
        } catch (error) {
          message.error(error.message || '禁用邀请码失败')
        }
      },
    })
  }

  if (currentRoom) {
    const isHost = currentRoom.hostId === user?.id
    const isWaiting = currentRoom.status === 'waiting'
    const hasOfflinePlayer = currentRoom.players.some((player) => player.online === false)

    return (
      <Card className="scene-card room-scene-card" style={{ width: 'min(100%, 760px)' }}>
        <header className="room-header">
          <Title level={3} className="scene-hero-title">房间: {currentRoom.id.slice(0, 8)}</Title>
          <Text className="scene-hero-subtitle">
            {isWaiting ? '等待其他玩家加入...' : '本局已结束或中止，可等待房主重新开始'}
          </Text>
        </header>

        <ConnectionStatusBanner
          className="scene-stack-gap"
          gameAlert={gameAlert}
          onClose={clearGameAlert}
          isConnected={isConnected}
          isReconnecting={isReconnecting}
          reconnectAttempts={reconnectAttempts}
          reconnectNextRetryAt={reconnectNextRetryAt}
        />

        <section className="scene-section">
          <Title level={4} className="scene-section-title">玩家列表 ({currentRoom.players.length}/3)</Title>
          <List
            className="room-player-list"
            dataSource={currentRoom.players}
            renderItem={(player) => (
              <List.Item className="room-player-row">
                <Space size={12} wrap>
                  <UserOutlined />
                  <Text strong={player.id === user?.id}>
                    {player.username}
                    {player.id === user?.id && ' (你)'}
                  </Text>
                  {player.id === currentRoom.hostId && <Tag className="room-status-chip" color="gold">房主</Tag>}
                  {player.online === false && <Tag color="red">离线</Tag>}
                  <Text className="scene-hero-subtitle">积分: {player.score}</Text>
                </Space>
              </List.Item>
            )}
          />
        </section>

        <div className="room-action-row">
          <Button
            type="primary"
            size="large"
            className="scene-primary-btn scene-action-btn"
            data-testid="start-game-button"
            disabled={currentRoom.players.length < 3 || !isHost || !isWaiting || hasOfflinePlayer}
            onClick={handleStartGame}
          >
            {currentRoom.players.length < 3
              ? `等待玩家 (${currentRoom.players.length}/3)`
              : hasOfflinePlayer
                ? '等待玩家重连'
                : !isHost
                  ? '等待房主开始'
                  : !isWaiting
                    ? '等待重新开局'
                    : '开始游戏'}
          </Button>

          <Button
            size="large"
            className="scene-subtle-btn scene-action-btn"
            data-testid="leave-room-button"
            onClick={handleLeaveRoom}
          >
            离开房间
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <Card className="scene-card room-scene-card" style={{ width: 'min(100%, 860px)' }}>
      <header className="room-header">
        <Title level={3} className="scene-hero-title">游戏大厅</Title>
        <Text className="scene-hero-subtitle">欢迎 {user?.username}，选择或创建房间开始游戏</Text>
      </header>

      <ConnectionStatusBanner
        className="scene-stack-gap"
        gameAlert={gameAlert}
        onClose={clearGameAlert}
        isConnected={isConnected}
        isReconnecting={isReconnecting}
        reconnectAttempts={reconnectAttempts}
        reconnectNextRetryAt={reconnectNextRetryAt}
      />

      <div className="lobby-actions">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          className="scene-accent-btn scene-action-btn"
          loading={loading}
          data-testid="create-room-button"
          onClick={handleCreateRoom}
        >
          创建房间
        </Button>

        <Button className="scene-subtle-btn scene-action-btn" loading={refreshing} onClick={handleRefreshRooms}>
          刷新列表
        </Button>
      </div>

      {authConfig?.emailEnabled !== false && accountInfo && (
        <section className="scene-section">
          <Title level={4} className="scene-section-title">会员中心</Title>
          <Space size={10} wrap style={{ marginBottom: 12 }}>
            {accountInfo?.isMember ? (
              <Tag color="gold">
                会员中（到期：{accountInfo?.memberExpiresAt ? new Date(accountInfo.memberExpiresAt).toLocaleString() : '长期'}）
              </Tag>
            ) : (
              <Tag>普通账号</Tag>
            )}
            {accountInfo?.isAdmin === true && <Tag color="purple">管理员</Tag>}
          </Space>
          <Space size={12} wrap>
            <Button
              type="primary"
              className="scene-primary-btn scene-action-btn"
              loading={memberLoading}
              onClick={handlePurchaseMembership}
            >
              {accountInfo?.isMember
                ? `续费 ${authConfig?.memberDefaultDays || 30} 天会员`
                : `开通 ${authConfig?.memberDefaultDays || 30} 天会员`}
            </Button>
            {accountInfo?.isMember === true && (
              <Button
                className="scene-subtle-btn scene-action-btn"
                loading={inviteLoading}
                onClick={handleCreateInviteCode}
              >
                生成邀请码
              </Button>
            )}
          </Space>
        </section>
      )}

      {accountInfo?.isAdmin === true && (
        <section className="scene-section">
          <Title level={4} className="scene-section-title">管理台（最小版）</Title>
          <Space direction="vertical" size={10} style={{ width: '100%', marginBottom: 12 }}>
            <Space wrap>
              <Input
                placeholder="目标邮箱"
                value={adminTargetEmail}
                style={{ width: 220 }}
                onChange={(event) => setAdminTargetEmail(event.target.value)}
              />
              <Input
                placeholder="会员天数"
                value={adminDurationDays}
                style={{ width: 120 }}
                onChange={(event) => setAdminDurationDays(event.target.value)}
              />
              <Input
                placeholder="原因（可选）"
                value={adminReason}
                style={{ width: 220 }}
                onChange={(event) => setAdminReason(event.target.value)}
              />
              <Button
                type="primary"
                className="scene-primary-btn"
                loading={adminGrantLoading}
                onClick={handleAdminGrantMembership}
              >
                发放会员
              </Button>
            </Space>
            <Space wrap>
              <Button
                className="scene-subtle-btn"
                loading={adminInviteLoading}
                onClick={handleAdminListInviteCodes}
              >
                刷新邀请码列表
              </Button>
            </Space>
          </Space>
          <List
            size="small"
            dataSource={adminInviteCodes}
            locale={{ emptyText: '暂无邀请码记录' }}
            renderItem={(inviteCode) => (
              <List.Item
                actions={[
                  inviteCode.status === 'active'
                    ? (
                      <Button
                        key={`${inviteCode.code}-disable`}
                        size="small"
                        danger
                        onClick={() => handleAdminDisableInviteCode(inviteCode.code)}
                      >
                        禁用
                      </Button>
                    )
                    : null,
                ].filter(Boolean)}
              >
                <Space size={10} wrap>
                  <Text strong>{inviteCode.code}</Text>
                  <Tag color={inviteCode.status === 'active' ? 'green' : 'default'}>{inviteCode.status}</Tag>
                  <Text type="secondary">channel: {inviteCode.channel || 'member'}</Text>
                  <Text type="secondary">campaign: {inviteCode.campaign || '-'}</Text>
                  <Text type="secondary">
                    到期：{inviteCode.expiresAt ? new Date(inviteCode.expiresAt).toLocaleString() : '-'}
                  </Text>
                  {inviteCode.disabledReason && (
                    <Text type="secondary">禁用原因：{inviteCode.disabledReason}</Text>
                  )}
                </Space>
              </List.Item>
            )}
          />
        </section>
      )}

      <section className="scene-section">
        <Title level={4} className="scene-section-title">可用房间</Title>
        {roomList.length === 0 ? (
          <div className="scene-empty-state">
            暂无可用房间，创建一个开始游戏吧！
          </div>
        ) : (
          <List
            className="lobby-room-list"
            dataSource={roomList}
            renderItem={(room) => (
              <List.Item
                className="lobby-room-item"
                actions={[
                  <Button
                    key={room.id}
                    type="primary"
                    size="small"
                    className="scene-primary-btn"
                    loading={loading}
                    data-testid={`join-room-${room.id}`}
                    onClick={() => handleJoinRoom(room.id)}
                  >
                    加入
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={<UserOutlined />}
                  title={`房间 ${room.id.slice(0, 8)}`}
                  description={`在线: ${room.onlineCount}/${room.playerCount} | 创建时间: ${new Date(room.createdAt).toLocaleTimeString()}`}
                />
              </List.Item>
            )}
          />
        )}
      </section>
    </Card>
  )
}

export default RoomScene

import React, { useEffect, useState } from 'react'
import { Button, Card, Drawer, Input, List, Modal, Pagination, Select, Space, Tag, Typography, message } from 'antd'
import {
  CrownOutlined,
  LogoutOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SettingOutlined,
  TrophyOutlined,
} from '@ant-design/icons'
import ConnectionStatusBanner from '../components/ConnectionStatusBanner'
import useGameStore from '../store/gameStore'

const { Title, Text } = Typography
const DEFAULT_BATTLE_STATS_LIMIT = 20
const BOT_DIFFICULTY_OPTIONS = [
  { value: 'easy', label: '简单' },
  { value: 'normal', label: '标准' },
  { value: 'hard', label: '进阶' },
]
const ROUND_TIMEOUT_OPTIONS = [
  { value: 30, label: '30 秒' },
  { value: 45, label: '45 秒' },
  { value: 60, label: '60 秒' },
  { value: 90, label: '90 秒' },
  { value: 120, label: '120 秒' },
]

function getBotDifficultyLabel(difficulty) {
  const normalized = typeof difficulty === 'string' ? difficulty.trim().toLowerCase() : ''
  const target = BOT_DIFFICULTY_OPTIONS.find((item) => item.value === normalized)
  return target ? target.label : '标准'
}

function normalizeDateInputValue(timestamp) {
  const value = Number(timestamp)
  if (!Number.isFinite(value) || value <= 0) {
    return ''
  }

  const date = new Date(value)
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateInputToTimestamp(dateText, { endOfDay = false } = {}) {
  if (typeof dateText !== 'string' || !dateText.trim()) {
    return null
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText.trim())) {
    return Number.NaN
  }

  const suffix = endOfDay
    ? 'T23:59:59.999'
    : 'T00:00:00.000'
  const parsed = Date.parse(`${dateText.trim()}${suffix}`)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

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
    adminListAuditLogs,
    adminAuditLogs,
    fetchBattleStats,
    battleStatsSummary,
    battleStatsRecords,
    battleStatsPagination,
    battleStatsFilters,
    addBots,
    removeBot,
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
  const [adminAuditLoading, setAdminAuditLoading] = useState(false)
  const [battleStatsLoading, setBattleStatsLoading] = useState(false)
  const [addBotLoading, setAddBotLoading] = useState(false)
  const [removingBotId, setRemovingBotId] = useState('')
  const [botDifficulty, setBotDifficulty] = useState('normal')
  const [roundSelectionTimeoutSec, setRoundSelectionTimeoutSec] = useState(60)
  const [soloLoading, setSoloLoading] = useState(false)
  const [battleRoomIdFilter, setBattleRoomIdFilter] = useState('')
  const [battleRankFilter, setBattleRankFilter] = useState('all')
  const [battleStartDateFilter, setBattleStartDateFilter] = useState('')
  const [battleEndDateFilter, setBattleEndDateFilter] = useState('')
  const [adminTargetEmail, setAdminTargetEmail] = useState('')
  const [adminDurationDays, setAdminDurationDays] = useState(String(authConfig?.memberDefaultDays || 30))
  const [adminReason, setAdminReason] = useState('')
  const [activeDrawer, setActiveDrawer] = useState(null)

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
    if (accountInfo?.isAdmin === true && adminAuditLogs.length === 0) {
      adminListAuditLogs({
        limit: authConfig?.adminAuditListLimit,
      }).catch(() => {})
    }
  }, [accountInfo?.isAdmin, authConfig?.adminAuditListLimit, adminAuditLogs.length, adminListAuditLogs])

  useEffect(() => {
    if (!currentRoom && user?.id && battleStatsRecords.length === 0) {
      fetchBattleStats({
        limit: DEFAULT_BATTLE_STATS_LIMIT,
        page: 1,
      }).catch(() => {})
    }
  }, [currentRoom, user?.id, battleStatsRecords.length, fetchBattleStats])

  useEffect(() => {
    setBattleRoomIdFilter(battleStatsFilters?.roomId || '')
    setBattleRankFilter(
      battleStatsFilters?.rank == null
        ? 'all'
        : String(battleStatsFilters.rank),
    )
    setBattleStartDateFilter(normalizeDateInputValue(battleStatsFilters?.startTime))
    setBattleEndDateFilter(normalizeDateInputValue(battleStatsFilters?.endTime))
  }, [
    battleStatsFilters?.roomId,
    battleStatsFilters?.rank,
    battleStatsFilters?.startTime,
    battleStatsFilters?.endTime,
  ])

  useEffect(() => {
    const nextDefaultDays = String(authConfig?.memberDefaultDays || 30)
    if (!adminDurationDays || Number(adminDurationDays) <= 0) {
      setAdminDurationDays(nextDefaultDays)
    }
  }, [authConfig?.memberDefaultDays])

  const handleCreateRoom = async () => {
    setLoading(true)
    try {
      await createRoom({
        selectionTimeoutMs: Number(roundSelectionTimeoutSec) * 1000,
      })
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

  const handleAddBot = async () => {
    if (!currentRoom) {
      return
    }

    setAddBotLoading(true)
    try {
      const payload = await addBots({
        roomId: currentRoom.id,
        count: 1,
        difficulty: botDifficulty,
      })
      const addedBot = Array.isArray(payload?.addedBots) ? payload.addedBots[0] : null
      if (addedBot?.username) {
        message.success(`已添加 ${addedBot.username}`)
        return
      }
      message.success('AI 补位成功')
    } catch (error) {
      message.error(error.message || '添加 AI 失败')
    } finally {
      setAddBotLoading(false)
    }
  }

  const handleRemoveBot = (botPlayer) => {
    if (!currentRoom || !botPlayer?.id) {
      return
    }

    Modal.confirm({
      title: `移除 ${botPlayer.username || '该 AI'}？`,
      content: '移除后将释放该席位',
      onOk: async () => {
        setRemovingBotId(botPlayer.id)
        try {
          await removeBot({
            roomId: currentRoom.id,
            botPlayerId: botPlayer.id,
          })
          message.success('AI 已移除')
        } catch (error) {
          message.error(error.message || '移除 AI 失败')
        } finally {
          setRemovingBotId('')
        }
      },
    })
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

  const handleCreateSoloGame = async ({ autoStart = true } = {}) => {
    if (soloLoading) {
      return
    }

    setSoloLoading(true)
    try {
      const room = await createRoom({
        selectionTimeoutMs: Number(roundSelectionTimeoutSec) * 1000,
      })
      const roomId = room?.id
      if (!roomId) {
        throw new Error('创建房间失败')
      }

      await addBots({
        roomId,
        count: 2,
        difficulty: botDifficulty,
      })

      if (autoStart) {
        await startGame(roomId)
        message.success('单机对战已开始')
      } else {
        message.success('单机调试房已创建，可手动开始')
      }
    } catch (error) {
      message.error(error.message || '创建单机房失败')
    } finally {
      setSoloLoading(false)
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

  const handleAdminListAuditLogs = async () => {
    setAdminAuditLoading(true)
    try {
      await adminListAuditLogs({
        limit: authConfig?.adminAuditListLimit,
      })
    } catch (error) {
      message.error(error.message || '加载审计日志失败')
    } finally {
      setAdminAuditLoading(false)
    }
  }

  const buildBattleStatsQuery = ({
    page = battleStatsPagination?.page || 1,
    limit = battleStatsPagination?.limit || DEFAULT_BATTLE_STATS_LIMIT,
  } = {}) => {
    const roomId = battleRoomIdFilter.trim()
    const rank = battleRankFilter === 'all' ? null : Number(battleRankFilter)
    const startTime = parseDateInputToTimestamp(battleStartDateFilter, { endOfDay: false })
    const endTime = parseDateInputToTimestamp(battleEndDateFilter, { endOfDay: true })

    if (battleStartDateFilter && !Number.isFinite(startTime)) {
      message.error('开始日期格式无效')
      return null
    }
    if (battleEndDateFilter && !Number.isFinite(endTime)) {
      message.error('结束日期格式无效')
      return null
    }
    if (
      Number.isFinite(startTime)
      && Number.isFinite(endTime)
      && startTime > endTime
    ) {
      message.error('开始日期不能晚于结束日期')
      return null
    }

    return {
      page,
      limit,
      roomId: roomId || undefined,
      rank: Number.isFinite(rank) && rank > 0 ? rank : undefined,
      startTime: Number.isFinite(startTime) ? startTime : undefined,
      endTime: Number.isFinite(endTime) ? endTime : undefined,
    }
  }

  const handleRefreshBattleStats = async () => {
    const query = buildBattleStatsQuery()
    if (!query) {
      return
    }

    setBattleStatsLoading(true)
    try {
      await fetchBattleStats(query)
    } catch (error) {
      message.error(error.message || '加载战绩失败')
    } finally {
      setBattleStatsLoading(false)
    }
  }

  const handleSearchBattleStats = async () => {
    const query = buildBattleStatsQuery({
      page: 1,
      limit: battleStatsPagination?.limit || DEFAULT_BATTLE_STATS_LIMIT,
    })
    if (!query) {
      return
    }

    setBattleStatsLoading(true)
    try {
      await fetchBattleStats(query)
    } catch (error) {
      message.error(error.message || '查询战绩失败')
    } finally {
      setBattleStatsLoading(false)
    }
  }

  const handleResetBattleStatsFilters = async () => {
    const resetFilters = {
      roomId: '',
      rank: 'all',
      startDate: '',
      endDate: '',
    }

    setBattleRoomIdFilter(resetFilters.roomId)
    setBattleRankFilter(resetFilters.rank)
    setBattleStartDateFilter(resetFilters.startDate)
    setBattleEndDateFilter(resetFilters.endDate)

    setBattleStatsLoading(true)
    try {
      await fetchBattleStats({
        page: 1,
        limit: battleStatsPagination?.limit || DEFAULT_BATTLE_STATS_LIMIT,
      })
    } catch (error) {
      message.error(error.message || '重置战绩筛选失败')
    } finally {
      setBattleStatsLoading(false)
    }
  }

  const handleBattleStatsPageChange = async (page, pageSize) => {
    const query = buildBattleStatsQuery({
      page,
      limit: pageSize || battleStatsPagination?.limit || DEFAULT_BATTLE_STATS_LIMIT,
    })
    if (!query) {
      return
    }

    setBattleStatsLoading(true)
    try {
      await fetchBattleStats(query)
    } catch (error) {
      message.error(error.message || '分页加载战绩失败')
    } finally {
      setBattleStatsLoading(false)
    }
  }

  if (currentRoom) {
    const isHost = currentRoom.hostId === user?.id
    const isWaiting = currentRoom.status === 'waiting'
    const hasOfflinePlayer = currentRoom.players.some((player) => player.online === false)
    const botPlayers = currentRoom.players.filter((player) => player.isBot === true)
    const canManageBots = isHost && isWaiting
    const isRoomFull = currentRoom.players.length >= 3
    const timeoutSeconds = Math.max(10, Math.floor((currentRoom.selectionTimeoutMs || 60000) / 1000))

    return (
      <div className="hud-room">
        <Card className="hud-panel hud-room-info" variant="borderless">
          <span className="hud-kicker">TABLE {currentRoom.id.slice(0, 8).toUpperCase()}</span>
          <Title level={3} className="hud-title">
            {isWaiting ? `等待入座 ${currentRoom.players.length}/3` : '本局已结束'}
          </Title>
          <Text className="hud-subtitle">
            {isWaiting ? '凑齐三人即可开局，空位可以用 AI 补上' : '可等待房主重新开始'}
            {' · '}选牌时限 {timeoutSeconds} 秒
          </Text>

          <ConnectionStatusBanner
            className="hud-stack-gap"
            gameAlert={gameAlert}
            onClose={clearGameAlert}
            isConnected={isConnected}
            isReconnecting={isReconnecting}
            reconnectAttempts={reconnectAttempts}
            reconnectNextRetryAt={reconnectNextRetryAt}
          />

          <div className="hud-section-label">
            玩家列表 ({currentRoom.players.length}/3)
            {botPlayers.length > 0 && ` · AI ${botPlayers.length}`}
          </div>
          <ul className="hud-room-players">
            {currentRoom.players.map((player) => (
              <li key={player.id} className={player.id === user?.id ? 'is-self' : ''}>
                <span className="hud-room-player-name">
                  {player.username}
                  {player.id === user?.id && ' (你)'}
                </span>
                <span className="hud-room-player-tags">
                  {player.isBot === true && <Tag color="cyan">AI · {getBotDifficultyLabel(player.botDifficulty)}</Tag>}
                  {player.id === currentRoom.hostId && <Tag color="gold">房主</Tag>}
                  {player.online === false && <Tag color="red">离线</Tag>}
                </span>
                <span className="hud-room-player-score">{player.score}</span>
                {canManageBots && player.isBot === true && (
                  <Button
                    size="small"
                    danger
                    type="text"
                    loading={removingBotId === player.id}
                    data-testid={`remove-bot-${player.id}`}
                    onClick={() => handleRemoveBot(player)}
                  >
                    移除
                  </Button>
                )}
              </li>
            ))}
            {Array.from({ length: Math.max(0, 3 - currentRoom.players.length) }).map((_, index) => (
              <li key={`empty-${index}`} className="is-empty">
                <span className="hud-room-player-name">空位</span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="hud-panel hud-action-dock">
          {canManageBots && (
            <Space.Compact>
              <Select
                value={botDifficulty}
                style={{ width: 110 }}
                options={BOT_DIFFICULTY_OPTIONS}
                onChange={setBotDifficulty}
                aria-label="AI 难度"
              />
              <Button
                icon={<RobotOutlined />}
                data-testid="add-bot-button"
                loading={addBotLoading}
                disabled={isRoomFull}
                onClick={handleAddBot}
              >
                {isRoomFull ? '房间已满' : '添加 AI'}
              </Button>
            </Space.Compact>
          )}
          <Button
            type="primary"
            size="large"
            className="hud-cta"
            data-testid="start-game-button"
            disabled={currentRoom.players.length < 3 || !isHost || !isWaiting || hasOfflinePlayer}
            onClick={handleStartGame}
            loading={loading}
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
            icon={<LogoutOutlined />}
            data-testid="leave-room-button"
            onClick={handleLeaveRoom}
          >
            离开
          </Button>
        </div>
      </div>
    )
  }

  const showMember = authConfig?.emailEnabled !== false && Boolean(accountInfo)
  const isAdmin = accountInfo?.isAdmin === true

  return (
    <div className="hud-lobby">
      <header className="hud-panel hud-topbar">
        <div className="hud-brand">
          <span className="hud-brand-mark">逮</span>
          <div>
            <strong>游戏大厅</strong>
            <span>欢迎 {user?.username}，选张桌子坐下吧</span>
          </div>
        </div>
        <Space wrap size={8}>
          <Button icon={<TrophyOutlined />} onClick={() => setActiveDrawer('stats')}>战绩</Button>
          {showMember && (
            <Button icon={<CrownOutlined />} onClick={() => setActiveDrawer('member')}>
              {accountInfo?.isMember ? '会员中' : '会员中心'}
            </Button>
          )}
          {isAdmin && (
            <Button icon={<SettingOutlined />} onClick={() => setActiveDrawer('admin')}>管理台</Button>
          )}
        </Space>
      </header>

      <ConnectionStatusBanner
        className="hud-stack-gap"
        gameAlert={gameAlert}
        onClose={clearGameAlert}
        isConnected={isConnected}
        isReconnecting={isReconnecting}
        reconnectAttempts={reconnectAttempts}
        reconnectNextRetryAt={reconnectNextRetryAt}
      />

      <div className="hud-lobby-grid">
        <Card className="hud-panel hud-lobby-create" variant="borderless">
          <span className="hud-kicker">NEW TABLE</span>
          <Title level={3} className="hud-title">开一桌</Title>
          <div className="hud-field">
            <label htmlFor="lobby-timeout">选牌时限</label>
            <Select
              id="lobby-timeout"
              value={roundSelectionTimeoutSec}
              options={ROUND_TIMEOUT_OPTIONS}
              onChange={setRoundSelectionTimeoutSec}
            />
          </div>
          <div className="hud-field">
            <label htmlFor="lobby-bot-difficulty">AI 难度</label>
            <Select
              id="lobby-bot-difficulty"
              value={botDifficulty}
              options={BOT_DIFFICULTY_OPTIONS}
              onChange={setBotDifficulty}
            />
          </div>
          <div className="hud-lobby-create-actions">
            <Button
              type="primary"
              size="large"
              block
              className="hud-cta"
              data-testid="create-solo-game-button"
              loading={soloLoading}
              onClick={() => handleCreateSoloGame({ autoStart: true })}
            >
              单机开局（你 + 2 AI）
            </Button>
            <Button
              size="large"
              block
              icon={<PlusOutlined />}
              loading={loading}
              data-testid="create-room-button"
              onClick={handleCreateRoom}
            >
              创建多人房间
            </Button>
            <Button
              type="text"
              block
              data-testid="create-solo-debug-room-button"
              loading={soloLoading}
              onClick={() => handleCreateSoloGame({ autoStart: false })}
            >
              创建调试房（1人+2AI，手动开始）
            </Button>
          </div>
        </Card>

        <Card className="hud-panel hud-lobby-rooms" variant="borderless">
          <div className="hud-panel-head">
            <div>
              <span className="hud-kicker">OPEN TABLES</span>
              <Title level={3} className="hud-title">可用房间</Title>
            </div>
            <Button icon={<ReloadOutlined />} loading={refreshing} onClick={handleRefreshRooms}>
              刷新
            </Button>
          </div>
          {roomList.length === 0 ? (
            <div className="hud-empty">暂无可用房间，创建一个开始游戏吧！</div>
          ) : (
            <ul className="hud-room-list">
              {roomList.map((room) => (
                <li key={room.id} className="hud-room-item">
                  <div className="hud-room-seats" aria-hidden="true">
                    {[0, 1, 2].map((index) => (
                      <span key={index} className={index < room.playerCount ? 'is-taken' : ''} />
                    ))}
                  </div>
                  <div className="hud-room-meta">
                    <strong>房间 {room.id.slice(0, 8)}</strong>
                    <span>
                      在线 {room.onlineCount}/{room.playerCount} · AI {room.botCount || 0} · {Math.max(10, Math.floor((room.selectionTimeoutMs || 60000) / 1000))} 秒 · {new Date(room.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <Button
                    type="primary"
                    loading={loading}
                    data-testid={`join-room-${room.id}`}
                    onClick={() => handleJoinRoom(room.id)}
                  >
                    加入
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Drawer
        title="战绩总览"
        width={Math.min(720, typeof window !== 'undefined' ? window.innerWidth : 720)}
        open={activeDrawer === 'stats'}
        onClose={() => setActiveDrawer(null)}
        className="hud-drawer"
      >
      <section className="hud-drawer-section">
        <Space size={8} wrap style={{ marginBottom: 12 }}>
          <Tag color="blue">总局数: {battleStatsSummary?.totalGames || 0}</Tag>
          <Tag color="green">胜场: {battleStatsSummary?.winCount || 0}</Tag>
          <Tag color="purple">
            胜率: {Number.isFinite(battleStatsSummary?.winRate)
              ? `${Math.round((battleStatsSummary.winRate || 0) * 100)}%`
              : '0%'}
          </Tag>
          <Tag color={(battleStatsSummary?.totalScoreChange || 0) >= 0 ? 'gold' : 'red'}>
            总分变化: {(battleStatsSummary?.totalScoreChange || 0) > 0 ? '+' : ''}{battleStatsSummary?.totalScoreChange || 0}
          </Tag>
          <Tag color="cyan">筛选命中: {battleStatsPagination?.total || 0}</Tag>
        </Space>
        <Space size={8} wrap style={{ marginBottom: 12 }}>
          <Input
            placeholder="房间ID筛选"
            value={battleRoomIdFilter}
            style={{ width: 180 }}
            onChange={(event) => setBattleRoomIdFilter(event.target.value)}
          />
          <Select
            value={battleRankFilter}
            style={{ width: 130 }}
            options={[
              { value: 'all', label: '全部名次' },
              { value: '1', label: '第 1 名' },
              { value: '2', label: '第 2 名' },
              { value: '3', label: '第 3 名' },
            ]}
            onChange={setBattleRankFilter}
          />
          <Input
            type="date"
            value={battleStartDateFilter}
            style={{ width: 150 }}
            onChange={(event) => setBattleStartDateFilter(event.target.value)}
          />
          <Input
            type="date"
            value={battleEndDateFilter}
            style={{ width: 150 }}
            onChange={(event) => setBattleEndDateFilter(event.target.value)}
          />
          <Button
            className="scene-primary-btn"
            loading={battleStatsLoading}
            onClick={handleSearchBattleStats}
          >
            查询
          </Button>
          <Button
            className="scene-subtle-btn"
            loading={battleStatsLoading}
            onClick={handleResetBattleStatsFilters}
          >
            重置
          </Button>
          <Button
            className="scene-subtle-btn"
            loading={battleStatsLoading}
            onClick={handleRefreshBattleStats}
          >
            刷新战绩
          </Button>
        </Space>
        <List
          size="small"
          loading={battleStatsLoading}
          dataSource={battleStatsRecords}
          locale={{ emptyText: '暂无对局记录' }}
          renderItem={(record) => (
            <List.Item>
              <Space size={10} wrap>
                <Tag color={record.rank === 1 ? 'gold' : record.rank === 2 ? 'blue' : 'default'}>
                  第 {record.rank} 名
                </Tag>
                <Tag color={record.totalScore >= 0 ? 'green' : 'red'}>
                  分差 {record.totalScore > 0 ? '+' : ''}{record.totalScore}
                </Tag>
                <Text type="secondary">
                  对手: {Array.isArray(record.opponents) && record.opponents.length > 0
                    ? record.opponents.map((item) => item.username).join(' / ')
                    : '-'}
                </Text>
                <Text type="secondary">
                  时间：{record.finishedAt ? new Date(record.finishedAt).toLocaleString() : '-'}
                </Text>
              </Space>
            </List.Item>
          )}
        />
        <Pagination
          size="small"
          style={{ marginTop: 12 }}
          current={battleStatsPagination?.page || 1}
          pageSize={battleStatsPagination?.limit || DEFAULT_BATTLE_STATS_LIMIT}
          total={battleStatsPagination?.total || 0}
          showSizeChanger={false}
          disabled={battleStatsLoading}
          onChange={handleBattleStatsPageChange}
        />
      </section>

      </Drawer>

      <Drawer
        title="会员中心"
        width={Math.min(480, typeof window !== 'undefined' ? window.innerWidth : 480)}
        open={activeDrawer === 'member'}
        onClose={() => setActiveDrawer(null)}
        className="hud-drawer"
      >
      {authConfig?.emailEnabled !== false && accountInfo && (
        <section className="hud-drawer-section">
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
            {authConfig?.memberSelfServicePurchaseEnabled === true ? (
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
            ) : (
              <Text type="secondary">会员暂不支持自助开通，请联系管理员</Text>
            )}
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

      </Drawer>

      <Drawer
        title="管理台"
        width={Math.min(760, typeof window !== 'undefined' ? window.innerWidth : 760)}
        open={activeDrawer === 'admin'}
        onClose={() => setActiveDrawer(null)}
        className="hud-drawer"
      >
      {accountInfo?.isAdmin === true && (
        <section className="hud-drawer-section">
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
              <Button
                className="scene-subtle-btn"
                loading={adminAuditLoading}
                onClick={handleAdminListAuditLogs}
              >
                刷新审计日志
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

          <List
            size="small"
            style={{ marginTop: 12 }}
            dataSource={adminAuditLogs}
            locale={{ emptyText: '暂无审计日志' }}
            renderItem={(log) => (
              <List.Item>
                <Space size={10} wrap>
                  <Tag color="blue">{log.action}</Tag>
                  <Text type="secondary">actor: {log.actorEmail || log.actorUserId || '-'}</Text>
                  <Text type="secondary">target: {log.targetEmail || log.targetUserId || '-'}</Text>
                  <Text type="secondary">source: {log.source || 'system'}</Text>
                  <Text type="secondary">
                    时间：{log.createdAt ? new Date(log.createdAt).toLocaleString() : '-'}
                  </Text>
                </Space>
              </List.Item>
            )}
          />
        </section>
      )}

      </Drawer>
    </div>
  )
}

export default RoomScene

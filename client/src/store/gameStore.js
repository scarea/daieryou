import { create } from 'zustand'
import { env } from '../config/env'
import { gameService } from '../services/gameService'
import { realtimeClient } from '../services/realtimeClient'

const STORAGE_KEY = 'daieryou_user'
const RECONNECT_DELAY_MS = 1500
const RECONNECT_MAX_DELAY_MS = 8000
const DEFAULT_AUTH_CONFIG = {
  emailEnabled: true,
  inviteRequired: false,
  inviteCodeLength: 8,
  memberDefaultDays: 30,
  adminInviteListLimit: 50,
  adminAuditListLimit: 50,
}
const DEFAULT_BATTLE_STATS_SUMMARY = {
  totalGames: 0,
  winCount: 0,
  winRate: 0,
  avgScore: 0,
  totalScoreChange: 0,
  recentScoreChange: 0,
}
const DEFAULT_BATTLE_STATS_PAGINATION = {
  total: 0,
  page: 1,
  limit: 20,
  totalPages: 0,
  hasMore: false,
}
const DEFAULT_BATTLE_STATS_FILTERS = {
  roomId: '',
  rank: null,
  startTime: null,
  endTime: null,
}

let eventsBound = false
let reconnectTimer = null

function persistUser(user) {
  if (user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    return
  }

  localStorage.removeItem(STORAGE_KEY)
}

function readStoredUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (error) {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function getReconnectDelayMs(attempt) {
  const normalizedAttempt = Math.max(1, attempt)
  return Math.min(RECONNECT_DELAY_MS * normalizedAttempt, RECONNECT_MAX_DELAY_MS)
}

function roomToListItem(room) {
  return {
    id: room.id,
    playerCount: room.players.length,
    onlineCount: room.players.filter((player) => player.online !== false).length,
    botCount: room.players.filter((player) => player.isBot === true).length,
    status: room.status,
    hostId: room.hostId,
    createdAt: room.createdAt,
    selectionTimeoutMs: Number.isInteger(room.selectionTimeoutMs) && room.selectionTimeoutMs > 0
      ? room.selectionTimeoutMs
      : undefined,
  }
}

function syncRoomList(roomList, room) {
  if (!room) {
    return roomList
  }

  if (room.status !== 'waiting') {
    return roomList.filter((item) => item.id !== room.id)
  }

  const nextRoom = roomToListItem(room)
  const exists = roomList.some((item) => item.id === room.id)

  if (exists) {
    return roomList.map((item) => (item.id === room.id ? nextRoom : item))
  }

  return [nextRoom, ...roomList]
}

function isUserInRoom(user, room) {
  if (!user || !room) {
    return false
  }

  return room.players.some((player) => player.id === user.id)
}

function resolveCurrentRoom(state, room) {
  if (!room) {
    return state.currentRoom
  }

  if (isUserInRoom(state.user, room)) {
    return room
  }

  if (state.currentRoom?.id === room.id) {
    return null
  }

  return state.currentRoom
}

function isCurrentRoomEvent(state, room) {
  if (!state.currentRoom || !room) {
    return false
  }

  return state.currentRoom.id === room.id
}

function getFinalRoundResultFromGameState(gameState) {
  if (!Array.isArray(gameState?.roundResults) || gameState.roundResults.length === 0) {
    return null
  }

  return gameState.roundResults[gameState.roundResults.length - 1] || null
}

function scheduleReconnect(set, get) {
  if (reconnectTimer) {
    return
  }

  const attempt = get().reconnectAttempts + 1
  const delayMs = getReconnectDelayMs(attempt)
  const nextRetryAt = Date.now() + delayMs

  set({
    isReconnecting: true,
    reconnectAttempts: attempt,
    reconnectNextRetryAt: nextRetryAt,
    gameAlert: '连接已断开，正在尝试重连...',
  })

  reconnectTimer = window.setTimeout(async () => {
    reconnectTimer = null
    const savedUser = readStoredUser()

    if (!savedUser?.username) {
      set({
        isReconnecting: false,
        gameAlert: null,
        reconnectAttempts: 0,
        reconnectNextRetryAt: null,
      })
      return
    }

    try {
      await get().connect()
      await get().login(savedUser.username, {
        preferredSessionToken: savedUser.sessionToken,
        silentReconnect: true,
      })
    } catch (error) {
      if (error.message === '会话已失效，请重新登录') {
        persistUser(null)
        set({
          user: null,
          isLoggedIn: false,
          currentRoom: null,
          gameState: null,
          finalScores: null,
          finalRoundResult: null,
          latestRoundResult: null,
          battleStatsSummary: DEFAULT_BATTLE_STATS_SUMMARY,
          battleStatsRecords: [],
          battleStatsTrend: [],
          battleStatsPagination: DEFAULT_BATTLE_STATS_PAGINATION,
          battleStatsFilters: DEFAULT_BATTLE_STATS_FILTERS,
          isConnected: false,
          isReconnecting: false,
          gameAlert: '登录状态已失效，请重新登录',
          reconnectAttempts: 0,
          reconnectNextRetryAt: null,
        })
        return
      }

      set({
        isConnected: false,
        isReconnecting: true,
        gameAlert: '连接已断开，正在尝试重连...',
      })
      scheduleReconnect(set, get)
    }
  }, delayMs)
}

function bindRealtimeEvents(set, get) {
  realtimeClient.on('lobbyUpdated', ({ rooms }) => {
    set({ roomList: rooms })
  })

  realtimeClient.on('roomUpdated', ({ room }) => {
    set((state) => ({
      currentRoom: resolveCurrentRoom(state, room),
      roomList: syncRoomList(state.roomList, room),
    }))
  })

  realtimeClient.on('playerJoined', ({ room }) => {
    set((state) => ({
      currentRoom: resolveCurrentRoom(state, room),
      roomList: syncRoomList(state.roomList, room),
    }))
  })

  realtimeClient.on('playerLeft', ({ room }) => {
    set((state) => {
      const nextCurrentRoom = resolveCurrentRoom(state, room)
      const leavingCurrentRoom = isCurrentRoomEvent(state, room) && nextCurrentRoom === null

      return {
        currentRoom: nextCurrentRoom,
        gameState: leavingCurrentRoom ? null : state.gameState,
        finalScores: leavingCurrentRoom ? null : state.finalScores,
        finalRoundResult: leavingCurrentRoom ? null : state.finalRoundResult,
        latestRoundResult: leavingCurrentRoom ? null : state.latestRoundResult,
        roomList: room ? syncRoomList(state.roomList, room) : state.roomList,
      }
    })
  })

  realtimeClient.on('playerConnectionChanged', ({ room, message }) => {
    set((state) => {
      const nextCurrentRoom = resolveCurrentRoom(state, room)
      const affectsCurrentRoom = isCurrentRoomEvent(state, room) && nextCurrentRoom !== null

      return {
        currentRoom: nextCurrentRoom,
        roomList: room ? syncRoomList(state.roomList, room) : state.roomList,
        gameAlert: affectsCurrentRoom ? message : state.gameAlert,
      }
    })
  })

  realtimeClient.on('gameStarted', ({ room, gameState }) => {
    set((state) => ({
      currentRoom: room || state.currentRoom,
      gameState,
      finalScores: null,
      finalRoundResult: null,
      latestRoundResult: null,
      roomList: room ? syncRoomList(state.roomList, room) : state.roomList,
      gameAlert: null,
    }))
  })

  realtimeClient.on('gameStateUpdated', ({ room, gameState, reason }) => {
    set((state) => ({
      currentRoom: room || state.currentRoom,
      gameState: gameState || state.gameState,
      roomList: room ? syncRoomList(state.roomList, room) : state.roomList,
      gameAlert: reason === 'timeout-partial'
        ? '有玩家超时，系统已自动托管选牌'
        : state.gameAlert,
    }))
  })

  realtimeClient.on('roundResult', ({ room, roundResult, gameState }) => {
    set((state) => {
      const maxRounds = Number(gameState?.maxRounds || state.gameState?.maxRounds || 0)
      const isFinalRoundResult = Number(roundResult?.round || 0) === maxRounds && maxRounds > 0

      return {
        currentRoom: room || state.currentRoom,
        latestRoundResult: roundResult,
        finalRoundResult: isFinalRoundResult ? roundResult : state.finalRoundResult,
        gameState,
        roomList: room ? syncRoomList(state.roomList, room) : state.roomList,
      }
    })
  })

  realtimeClient.on('gameEnded', ({ room, finalScores, finalRoundResult, gameState }) => {
    set((state) => ({
      currentRoom: room || state.currentRoom,
      finalScores,
      finalRoundResult: finalRoundResult
        || getFinalRoundResultFromGameState(gameState)
        || state.finalRoundResult
        || null,
      gameState,
      roomList: room ? syncRoomList(state.roomList, room) : state.roomList,
    }))
  })

  realtimeClient.on('gameAborted', ({ room, reason }) => {
    set((state) => {
      const nextCurrentRoom = resolveCurrentRoom(state, room)
      const affectsCurrentRoom = isCurrentRoomEvent(state, room)

      return {
        currentRoom: nextCurrentRoom,
        gameState: affectsCurrentRoom ? null : state.gameState,
        finalScores: affectsCurrentRoom ? null : state.finalScores,
        finalRoundResult: affectsCurrentRoom ? null : state.finalRoundResult,
        latestRoundResult: affectsCurrentRoom ? null : state.latestRoundResult,
        roomList: room ? syncRoomList(state.roomList, room) : state.roomList,
        gameAlert: affectsCurrentRoom ? reason : state.gameAlert,
      }
    })
  })

  realtimeClient.on('connection.closed', () => {
    const savedUser = readStoredUser()

    set({
      isConnected: false,
      bootstrapStatus: 'ready',
      reconnectNextRetryAt: null,
    })

    if (!savedUser?.username) {
      set({
        isReconnecting: false,
        reconnectAttempts: 0,
      })
      return
    }

    scheduleReconnect(set, get)
  })
}

const useGameStore = create((set, get) => ({
  bootstrapStatus: 'idle',
  user: null,
  isLoggedIn: false,
  isConnected: false,
  isReconnecting: false,
  reconnectAttempts: 0,
  reconnectNextRetryAt: null,
  currentRoom: null,
  roomList: [],
  gameState: null,
  latestRoundResult: null,
  finalScores: null,
  finalRoundResult: null,
  gameAlert: null,
  accountInfo: null,
  authConfig: DEFAULT_AUTH_CONFIG,
  adminInviteCodes: [],
  adminAuditLogs: [],
  battleStatsSummary: DEFAULT_BATTLE_STATS_SUMMARY,
  battleStatsRecords: [],
  battleStatsTrend: [],
  battleStatsPagination: DEFAULT_BATTLE_STATS_PAGINATION,
  battleStatsFilters: DEFAULT_BATTLE_STATS_FILTERS,

  setUser: (user) => {
    persistUser(user)
    set({ user, isLoggedIn: Boolean(user) })
  },

  restoreUser: () => {
    const user = readStoredUser()
    if (user) {
      set({ user, isLoggedIn: true })
    }
    return user
  },

  connect: async () => {
    await realtimeClient.connect(env.wsUrl)

    if (!eventsBound) {
      bindRealtimeEvents(set, get)
      eventsBound = true
    }

    set({
      isConnected: true,
      isReconnecting: false,
      reconnectAttempts: 0,
      reconnectNextRetryAt: null,
    })
    return realtimeClient
  },

  bootstrap: async () => {
    const { bootstrapStatus, connect, login, fetchAuthConfig } = get()
    if (bootstrapStatus === 'loading' || bootstrapStatus === 'ready') {
      return
    }

    set({ bootstrapStatus: 'loading' })

    try {
      await connect()
      await fetchAuthConfig()

      const savedUser = readStoredUser()
      if (savedUser?.username) {
        await login(savedUser.username, { preferredSessionToken: savedUser.sessionToken })
        await fetchAuthConfig()
      }

      set({ bootstrapStatus: 'ready' })
    } catch (error) {
      persistUser(null)
      clearReconnectTimer()
      set({
        user: null,
        isLoggedIn: false,
        currentRoom: null,
        gameState: null,
        finalScores: null,
        finalRoundResult: null,
        battleStatsSummary: DEFAULT_BATTLE_STATS_SUMMARY,
        battleStatsRecords: [],
        battleStatsTrend: [],
        battleStatsPagination: DEFAULT_BATTLE_STATS_PAGINATION,
        battleStatsFilters: DEFAULT_BATTLE_STATS_FILTERS,
        bootstrapStatus: 'ready',
        isReconnecting: false,
        reconnectAttempts: 0,
        reconnectNextRetryAt: null,
        authConfig: DEFAULT_AUTH_CONFIG,
      })
    }
  },

  disconnect: () => {
    clearReconnectTimer()
    realtimeClient.disconnect()
    set({
      isConnected: false,
      isReconnecting: false,
      reconnectAttempts: 0,
      reconnectNextRetryAt: null,
      accountInfo: null,
      battleStatsSummary: DEFAULT_BATTLE_STATS_SUMMARY,
      battleStatsRecords: [],
      battleStatsTrend: [],
      battleStatsPagination: DEFAULT_BATTLE_STATS_PAGINATION,
      battleStatsFilters: DEFAULT_BATTLE_STATS_FILTERS,
    })
  },

  login: async (username, options = {}) => {
    if (!get().isConnected) {
      await get().connect()
    }

    const trimmedUsername = username.trim()
    const savedUser = readStoredUser()
    const preferredSessionToken = options.preferredSessionToken
      || (savedUser?.username === trimmedUsername ? savedUser.sessionToken : undefined)

    const payload = await gameService.login(trimmedUsername, preferredSessionToken)
    const nextUser = payload.user
      ? {
        ...payload.user,
        sessionToken: payload.sessionToken || null,
      }
      : null
    get().setUser(nextUser)

    set((state) => ({
      currentRoom: payload.room || null,
      gameState: payload.gameState || null,
      finalScores: payload.finalScores || null,
      finalRoundResult: payload.finalRoundResult || getFinalRoundResultFromGameState(payload.gameState) || null,
      latestRoundResult: null,
      roomList: payload.rooms || state.roomList,
      isConnected: true,
      isReconnecting: false,
      reconnectAttempts: 0,
      reconnectNextRetryAt: null,
      accountInfo: payload.account || null,
      battleStatsSummary: DEFAULT_BATTLE_STATS_SUMMARY,
      battleStatsRecords: [],
      battleStatsTrend: [],
      battleStatsPagination: DEFAULT_BATTLE_STATS_PAGINATION,
      battleStatsFilters: DEFAULT_BATTLE_STATS_FILTERS,
      gameAlert: options.silentReconnect
        ? payload.room
          ? '已重新连接并恢复会话'
          : '已重新连接'
        : null,
    }))

    return nextUser
  },

  createRoom: async ({ selectionTimeoutMs } = {}) => {
    const { room } = await gameService.createRoom({ selectionTimeoutMs })
    set({
      currentRoom: room,
      gameState: null,
      finalScores: null,
      finalRoundResult: null,
      latestRoundResult: null,
      gameAlert: null,
    })
    return room
  },

  joinRoom: async (roomId) => {
    const { room } = await gameService.joinRoom(roomId)
    set({ currentRoom: room, finalScores: null, finalRoundResult: null, latestRoundResult: null, gameAlert: null })
    return room
  },

  addBots: async ({ roomId, count = 1, difficulty } = {}) => {
    const targetRoomId = roomId || get().currentRoom?.id
    if (!targetRoomId) {
      throw new Error('房间不存在')
    }

    const payload = await gameService.addBots({
      roomId: targetRoomId,
      count,
      difficulty,
    })
    set((state) => ({
      currentRoom: payload?.room || state.currentRoom,
      roomList: payload?.room ? syncRoomList(state.roomList, payload.room) : state.roomList,
    }))
    return payload
  },

  removeBot: async ({ roomId, botPlayerId } = {}) => {
    const targetRoomId = roomId || get().currentRoom?.id
    if (!targetRoomId) {
      throw new Error('房间不存在')
    }
    if (!botPlayerId) {
      throw new Error('AI 玩家不存在')
    }

    const payload = await gameService.removeBot({
      roomId: targetRoomId,
      botPlayerId,
    })
    set((state) => ({
      currentRoom: payload?.room || state.currentRoom,
      roomList: payload?.room ? syncRoomList(state.roomList, payload.room) : state.roomList,
    }))
    return payload
  },

  leaveRoom: async () => {
    const { currentRoom } = get()
    if (!currentRoom) {
      return
    }

    await gameService.leaveRoom(currentRoom.id)
    set({
      currentRoom: null,
      gameState: null,
      finalScores: null,
      finalRoundResult: null,
      latestRoundResult: null,
      gameAlert: null,
    })
  },

  getRoomList: async () => {
    const { rooms } = await gameService.getRoomList()
    set({ roomList: rooms })
    return rooms
  },

  startGame: async (roomId) => {
    const { gameState } = await gameService.startGame(roomId)
    set({ gameState, finalScores: null, finalRoundResult: null, latestRoundResult: null, gameAlert: null })
    return gameState
  },

  restartGame: async (roomId) => {
    const { gameState } = await gameService.restartGame(roomId)
    set({ gameState, finalScores: null, finalRoundResult: null, latestRoundResult: null, gameAlert: null })
    return gameState
  },

  selectCards: async (roomId, round, selectedCards) => {
    const { gameState } = await gameService.selectCards(roomId, round, selectedCards)
    set({ gameState })
    return gameState
  },

  clearLatestRoundResult: () => {
    set({ latestRoundResult: null })
  },

  clearGameAlert: () => {
    set({ gameAlert: null })
  },

  fetchAuthConfig: async () => {
    if (!get().isConnected) {
      await get().connect()
    }

    const payload = await gameService.getAuthConfig()
    set((state) => ({
      authConfig: {
        emailEnabled: payload?.emailEnabled !== false,
        inviteRequired: payload?.inviteRequired === true,
        inviteCodeLength: Number(payload?.inviteCodeLength) > 0
          ? Number(payload.inviteCodeLength)
          : DEFAULT_AUTH_CONFIG.inviteCodeLength,
        memberDefaultDays: Number(payload?.memberDefaultDays) > 0
          ? Number(payload.memberDefaultDays)
          : DEFAULT_AUTH_CONFIG.memberDefaultDays,
        adminInviteListLimit: Number(payload?.adminInviteListLimit) > 0
          ? Number(payload.adminInviteListLimit)
          : DEFAULT_AUTH_CONFIG.adminInviteListLimit,
        adminAuditListLimit: Number(payload?.adminAuditListLimit) > 0
          ? Number(payload.adminAuditListLimit)
          : DEFAULT_AUTH_CONFIG.adminAuditListLimit,
      },
      accountInfo: payload?.currentAccount || state.accountInfo,
    }))
    return payload
  },

  sendEmailCode: async (email) => {
    if (!get().isConnected) {
      await get().connect()
    }
    return gameService.sendEmailCode(email)
  },

  registerWithEmail: async ({ email, password, verificationCode, username, inviteCode }) => {
    if (!get().isConnected) {
      await get().connect()
    }

    const payload = await gameService.register({
      email,
      password,
      verificationCode,
      username,
      inviteCode,
    })
    const nextUser = payload.user
      ? {
        ...payload.user,
        sessionToken: payload.sessionToken || null,
      }
      : null
    get().setUser(nextUser)

    set((state) => ({
      currentRoom: payload.room || null,
      gameState: payload.gameState || null,
      finalScores: payload.finalScores || null,
      finalRoundResult: payload.finalRoundResult || getFinalRoundResultFromGameState(payload.gameState) || null,
      latestRoundResult: null,
      roomList: payload.rooms || state.roomList,
      isConnected: true,
      isReconnecting: false,
      reconnectAttempts: 0,
      reconnectNextRetryAt: null,
      accountInfo: payload.account || null,
      battleStatsSummary: DEFAULT_BATTLE_STATS_SUMMARY,
      battleStatsRecords: [],
      battleStatsTrend: [],
      battleStatsPagination: DEFAULT_BATTLE_STATS_PAGINATION,
      battleStatsFilters: DEFAULT_BATTLE_STATS_FILTERS,
      gameAlert: null,
    }))

    return nextUser
  },

  loginWithPassword: async ({ email, password }) => {
    if (!get().isConnected) {
      await get().connect()
    }

    const payload = await gameService.loginWithPassword(email, password)
    const nextUser = payload.user
      ? {
        ...payload.user,
        sessionToken: payload.sessionToken || null,
      }
      : null
    get().setUser(nextUser)

    set((state) => ({
      currentRoom: payload.room || null,
      gameState: payload.gameState || null,
      finalScores: payload.finalScores || null,
      finalRoundResult: payload.finalRoundResult || getFinalRoundResultFromGameState(payload.gameState) || null,
      latestRoundResult: null,
      roomList: payload.rooms || state.roomList,
      isConnected: true,
      isReconnecting: false,
      reconnectAttempts: 0,
      reconnectNextRetryAt: null,
      accountInfo: payload.account || null,
      battleStatsSummary: DEFAULT_BATTLE_STATS_SUMMARY,
      battleStatsRecords: [],
      battleStatsTrend: [],
      battleStatsPagination: DEFAULT_BATTLE_STATS_PAGINATION,
      battleStatsFilters: DEFAULT_BATTLE_STATS_FILTERS,
      gameAlert: null,
    }))

    return nextUser
  },

  createInviteCode: async () => {
    if (!get().isConnected) {
      await get().connect()
    }

    return gameService.createInviteCode()
  },

  purchaseMembership: async (planDays) => {
    if (!get().isConnected) {
      await get().connect()
    }

    const payload = await gameService.purchaseMembership(planDays)
    set((state) => ({
      accountInfo: payload?.account || state.accountInfo,
      authConfig: {
        ...state.authConfig,
        memberDefaultDays: Number(planDays) > 0
          ? Number(planDays)
          : state.authConfig.memberDefaultDays,
      },
    }))
    return payload
  },

  adminGrantMembership: async ({ targetEmail, durationDays, reason }) => {
    if (!get().isConnected) {
      await get().connect()
    }

    return gameService.adminGrantMembership({ targetEmail, durationDays, reason })
  },

  adminListInviteCodes: async ({ limit, status } = {}) => {
    if (!get().isConnected) {
      await get().connect()
    }

    const payload = await gameService.adminListInviteCodes({ limit, status })
    set({
      adminInviteCodes: Array.isArray(payload?.inviteCodes)
        ? payload.inviteCodes
        : [],
    })
    return payload
  },

  adminDisableInviteCode: async ({ code, reason }) => {
    if (!get().isConnected) {
      await get().connect()
    }

    return gameService.adminDisableInviteCode({ code, reason })
  },

  adminListAuditLogs: async ({ limit, action } = {}) => {
    if (!get().isConnected) {
      await get().connect()
    }

    const payload = await gameService.adminListAuditLogs({ limit, action })
    set({
      adminAuditLogs: Array.isArray(payload?.logs)
        ? payload.logs
        : [],
    })
    return payload
  },

  fetchBattleStats: async ({
    limit = DEFAULT_BATTLE_STATS_PAGINATION.limit,
    page = DEFAULT_BATTLE_STATS_PAGINATION.page,
    roomId,
    rank,
    startTime,
    endTime,
  } = {}) => {
    if (!get().isConnected) {
      await get().connect()
    }

    const payload = await gameService.getBattleStats({
      limit,
      page,
      roomId,
      rank,
      startTime,
      endTime,
    })
    set({
      battleStatsSummary: payload?.summary || DEFAULT_BATTLE_STATS_SUMMARY,
      battleStatsRecords: Array.isArray(payload?.records)
        ? payload.records
        : [],
      battleStatsTrend: Array.isArray(payload?.trend)
        ? payload.trend
        : [],
      battleStatsPagination: payload?.pagination || {
        ...DEFAULT_BATTLE_STATS_PAGINATION,
        page: Number(payload?.page) > 0 ? Number(payload.page) : page,
        limit: Number(payload?.limit) > 0 ? Number(payload.limit) : limit,
      },
      battleStatsFilters: payload?.filters || {
        roomId: typeof roomId === 'string' ? roomId : DEFAULT_BATTLE_STATS_FILTERS.roomId,
        rank: rank == null ? DEFAULT_BATTLE_STATS_FILTERS.rank : rank,
        startTime: startTime == null ? DEFAULT_BATTLE_STATS_FILTERS.startTime : startTime,
        endTime: endTime == null ? DEFAULT_BATTLE_STATS_FILTERS.endTime : endTime,
      },
    })
    return payload
  },

  exitCurrentRoom: async () => {
    const { currentRoom } = get()
    if (currentRoom) {
      await get().leaveRoom()
      return
    }

    set({
      currentRoom: null,
      gameState: null,
      finalScores: null,
      finalRoundResult: null,
      latestRoundResult: null,
      gameAlert: null,
    })
  },

  backToLobby: () => {
    set({ currentRoom: null, gameState: null, finalScores: null, finalRoundResult: null, latestRoundResult: null })
  },
}))

export default useGameStore

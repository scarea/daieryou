import { realtimeClient } from './realtimeClient'

function unwrapResponse(response) {
  if (response.code !== 200) {
    throw new Error(response.error || '请求失败')
  }

  return response.data
}

function buildOperationId(action, parts = []) {
  return [action, ...parts].join(':')
}

export const gameService = {
  getAuthConfig() {
    return realtimeClient.request('connector.entryHandler.getAuthConfig').then(unwrapResponse)
  },
  sendEmailCode(email) {
    return realtimeClient.request('connector.entryHandler.sendEmailCode', { email }).then(unwrapResponse)
  },
  register({ email, password, verificationCode, username, inviteCode }) {
    return realtimeClient.request('connector.entryHandler.register', {
      email,
      password,
      verificationCode,
      username,
      inviteCode,
    }).then(unwrapResponse)
  },
  loginWithPassword(email, password) {
    return realtimeClient.request('connector.entryHandler.loginWithPassword', {
      email,
      password,
    }).then(unwrapResponse)
  },
  createInviteCode() {
    return realtimeClient.request('connector.entryHandler.createInviteCode', {
      operationId: buildOperationId('create-invite-code'),
    }).then(unwrapResponse)
  },
  purchaseMembership(planDays) {
    return realtimeClient.request('connector.entryHandler.purchaseMembership', {
      planDays,
      operationId: buildOperationId('purchase-membership', [planDays || 'default']),
    }).then(unwrapResponse)
  },
  adminGrantMembership({ targetEmail, durationDays, reason }) {
    return realtimeClient.request('connector.entryHandler.adminGrantMembership', {
      targetEmail,
      durationDays,
      reason,
      operationId: buildOperationId('admin-grant-membership', [targetEmail || '']),
    }).then(unwrapResponse)
  },
  adminListInviteCodes({ limit, status } = {}) {
    return realtimeClient.request('connector.entryHandler.adminListInviteCodes', {
      limit,
      status,
    }).then(unwrapResponse)
  },
  adminDisableInviteCode({ code, reason }) {
    return realtimeClient.request('connector.entryHandler.adminDisableInviteCode', {
      code,
      reason,
      operationId: buildOperationId('admin-disable-invite', [code || '']),
    }).then(unwrapResponse)
  },
  adminListAuditLogs({ limit, action } = {}) {
    return realtimeClient.request('connector.entryHandler.adminListAuditLogs', {
      limit,
      action,
    }).then(unwrapResponse)
  },
  getBattleStats({ limit, page, roomId, rank, startTime, endTime } = {}) {
    return realtimeClient.request('connector.entryHandler.getBattleStats', {
      limit,
      page,
      roomId,
      rank,
      startTime,
      endTime,
    }).then(unwrapResponse)
  },
  login(username, sessionToken) {
    return realtimeClient.request('connector.entryHandler.login', { username, sessionToken }).then(unwrapResponse)
  },
  createRoom() {
    return realtimeClient.request('game.roomHandler.createRoom', {
      operationId: buildOperationId('create-room'),
    }).then(unwrapResponse)
  },
  joinRoom(roomId) {
    return realtimeClient.request('game.roomHandler.joinRoom', {
      roomId,
      operationId: buildOperationId('join-room', [roomId]),
    }).then(unwrapResponse)
  },
  leaveRoom(roomId) {
    return realtimeClient.request('game.roomHandler.leaveRoom', {
      roomId,
      operationId: buildOperationId('leave-room', [roomId]),
    }).then(unwrapResponse)
  },
  getRoomList() {
    return realtimeClient.request('game.roomHandler.getRoomList').then(unwrapResponse)
  },
  startGame(roomId) {
    return realtimeClient.request('game.gameHandler.startGame', {
      roomId,
      operationId: buildOperationId('start-game', [roomId]),
    }).then(unwrapResponse)
  },
  restartGame(roomId) {
    return realtimeClient.request('game.gameHandler.restartGame', {
      roomId,
      operationId: buildOperationId('restart-game', [roomId]),
    }).then(unwrapResponse)
  },
  selectCards(roomId, round, selectedCards) {
    const normalizedSelectedCards = [...selectedCards].sort((left, right) => left - right)
    return realtimeClient.request('game.gameHandler.selectCards', {
      roomId,
      round,
      selectedCards,
      operationId: buildOperationId('select-cards', [roomId, round, normalizedSelectedCards.join('-')]),
    }).then(unwrapResponse)
  },
}

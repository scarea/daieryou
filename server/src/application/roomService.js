const { v4: uuidv4 } = require('uuid')
const { serializePlayer, serializeRoom, serializeRoomList } = require('../domain/roomView')

class RoomService {
  constructor({ roomRepository, broadcaster, lobbyBroadcaster }) {
    this.roomRepository = roomRepository
    this.broadcaster = broadcaster
    this.lobbyBroadcaster = lobbyBroadcaster
  }

  getCurrentRoomForUser(userId) {
    return this.roomRepository.findByUserId(userId)
  }

  getRoomList() {
    return serializeRoomList(this.roomRepository.listWaitingRooms())
  }

  saveAndBroadcastRoom(room) {
    this.roomRepository.save(room)
    const publicRoom = serializeRoom(room)
    this.broadcaster.broadcast(room, 'roomUpdated', { room: publicRoom })
    this.lobbyBroadcaster.broadcastRoomList()
    return publicRoom
  }

  updateRoomPlayer(room, userId, updater) {
    room.players = room.players.map((player) => {
      if (player.id !== userId) {
        return player
      }

      return updater(player)
    })

    if (room.gameState?.players) {
      room.gameState.players = room.gameState.players.map((player) => {
        if (player.id !== userId) {
          return player
        }

        return updater(player)
      })
    }
  }

  setUserOnline(user) {
    const room = this.getCurrentRoomForUser(user.id)
    if (!room) {
      return null
    }

    this.updateRoomPlayer(room, user.id, (player) => ({
      ...player,
      username: user.username,
      online: true,
      lastSeenAt: Date.now(),
    }))

    this.saveAndBroadcastRoom(room)
    this.broadcaster.broadcast(room, 'playerConnectionChanged', {
      room: serializeRoom(room),
      userId: user.id,
      online: true,
      message: `${user.username} 已重新连接`,
    })

    return room
  }

  setUserOffline(userId, graceMs) {
    const room = this.getCurrentRoomForUser(userId)
    if (!room) {
      return null
    }

    const player = room.players.find((item) => item.id === userId)
    if (!player) {
      return null
    }

    this.updateRoomPlayer(room, userId, (currentPlayer) => ({
      ...currentPlayer,
      online: false,
      lastSeenAt: Date.now(),
    }))

    this.saveAndBroadcastRoom(room)
    this.broadcaster.broadcast(room, 'playerConnectionChanged', {
      room: serializeRoom(room),
      userId,
      online: false,
      message: `${player.username} 断开连接，系统保留席位 ${Math.floor(graceMs / 1000)} 秒`,
    })

    return room
  }

  createRoom(user) {
    if (!user) {
      throw new Error('用户未登录')
    }

    const existingRoom = this.getCurrentRoomForUser(user.id)
    if (existingRoom) {
      return serializeRoom(existingRoom)
    }

    const room = {
      id: uuidv4(),
      players: [
        {
          ...user,
          online: true,
          lastSeenAt: Date.now(),
        },
      ],
      hostId: user.id,
      status: 'waiting',
      createdAt: Date.now(),
      gameState: null,
      finalScores: null,
      finishedAt: null,
    }

    this.roomRepository.save(room)
    this.lobbyBroadcaster.broadcastRoomList()
    return serializeRoom(room)
  }

  joinRoom(user, roomId) {
    if (!user) {
      throw new Error('用户未登录')
    }

    const room = this.roomRepository.get(roomId)
    if (!room) {
      throw new Error('房间不存在')
    }
    if (room.players.length >= 3) {
      throw new Error('房间已满')
    }
    if (room.status !== 'waiting') {
      throw new Error('游戏已开始')
    }
    if (room.players.some((player) => player.id === user.id)) {
      throw new Error('已在房间中')
    }

    room.players.push({
      ...user,
      online: true,
      lastSeenAt: Date.now(),
    })

    this.broadcaster.broadcast(room, 'playerJoined', {
      player: serializePlayer(user),
      room: serializeRoom(room),
    })
    return this.saveAndBroadcastRoom(room)
  }

  leaveRoom(user, roomId) {
    if (!user) {
      throw new Error('用户未登录')
    }

    const room = this.roomRepository.get(roomId)
    if (!room) {
      throw new Error('房间不存在')
    }
    if (!room.players.some((player) => player.id === user.id)) {
      throw new Error('不在房间中')
    }

    return this.removeUserFromRoom(room, user.id, {
      reason: `${user.username} 已离开房间`,
      playerPayload: serializePlayer(user),
    })
  }

  removeUserFromRoom(room, userId, options = {}) {
    const leavingPlayer = room.players.find((player) => player.id === userId)
    if (!leavingPlayer) {
      return { deleted: false, room: serializeRoom(room) }
    }

    const wasPlaying = room.status === 'playing'
    room.players = room.players.filter((player) => player.id !== userId)

    if (room.gameState?.players) {
      room.gameState.players = room.gameState.players.filter((player) => player.id !== userId)
    }

    if (room.players.length === 0) {
      this.roomRepository.delete(room.id)
      this.lobbyBroadcaster.broadcastRoomList()
      return { deleted: true, room: null }
    }

    if (room.hostId === userId) {
      room.hostId = room.players[0].id
    }

    if (wasPlaying) {
      room.status = 'finished'
      room.gameState = null
      room.finalScores = null
      room.finishedAt = Date.now()
    }

    this.roomRepository.save(room)

    const publicRoom = serializeRoom(room)
    this.broadcaster.broadcast(room, 'playerLeft', {
      userId,
      player: options.playerPayload || serializePlayer(leavingPlayer),
      room: publicRoom,
    })
    this.broadcaster.broadcast(room, 'roomUpdated', { room: publicRoom })

    if (wasPlaying) {
      this.broadcaster.broadcast(room, 'gameAborted', {
        room: publicRoom,
        reason: options.reason || `${leavingPlayer.username} 已离开房间，本局结束`,
      })
    }

    this.lobbyBroadcaster.broadcastRoomList()
    return { deleted: false, room: publicRoom }
  }

  cleanupUserFromRooms(userId, options = {}) {
    for (const [, room] of this.roomRepository.entries()) {
      if (!room.players.some((player) => player.id === userId)) {
        continue
      }

      this.removeUserFromRoom(room, userId, options)
    }
  }
}

module.exports = { RoomService }

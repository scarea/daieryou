// SOCKET_OPEN；不直接依赖 ws 库，Node 与 Cloudflare 的 WebSocket 都适用
const SOCKET_OPEN = 1
const { serializeRoomList } = require('../domain/roomView')

class LobbyBroadcaster {
  constructor({ sessionRepository, roomRepository }) {
    this.sessionRepository = sessionRepository
    this.roomRepository = roomRepository
  }

  buildRoomList() {
    return serializeRoomList(this.roomRepository.listWaitingRooms())
  }

  sendRoomList(session) {
    if (!session || session.ws.readyState !== SOCKET_OPEN) {
      return
    }

    session.ws.send(JSON.stringify({
      route: 'lobbyUpdated',
      body: { rooms: this.buildRoomList() },
    }))
  }

  broadcastRoomList() {
    const rooms = this.buildRoomList()
    this.sessionRepository.forEachBoundUser((session) => {
      if (!session || session.ws.readyState !== SOCKET_OPEN) {
        return
      }

      session.ws.send(JSON.stringify({
        route: 'lobbyUpdated',
        body: { rooms },
      }))
    })
  }
}

module.exports = { LobbyBroadcaster }

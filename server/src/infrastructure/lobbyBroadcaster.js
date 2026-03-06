const WebSocket = require('ws')
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
    if (!session || session.ws.readyState !== WebSocket.OPEN) {
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
      if (!session || session.ws.readyState !== WebSocket.OPEN) {
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

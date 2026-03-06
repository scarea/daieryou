function serializePlayer(player) {
  return {
    id: player.id,
    username: player.username,
    score: player.score,
    online: player.online !== false,
  }
}

function serializeRoom(room) {
  if (!room) {
    return null
  }

  return {
    id: room.id,
    hostId: room.hostId,
    status: room.status,
    createdAt: room.createdAt,
    players: room.players.map(serializePlayer),
  }
}

function serializeRoomList(rooms) {
  return rooms.map((room) => ({
    id: room.id,
    playerCount: room.players.length,
    onlineCount: room.players.filter((player) => player.online !== false).length,
    status: room.status,
    hostId: room.hostId,
    createdAt: room.createdAt,
  }))
}

module.exports = {
  serializePlayer,
  serializeRoom,
  serializeRoomList,
}

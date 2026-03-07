const { appContext } = require('../../../../src/application/appContext')

module.exports = function(app) {
  return new Handler(app)
}

class Handler {
  constructor(app) {
    this.app = app
  }

  /**
   * 创建房间
   */
  async createRoom(msg, session, next) {
    try {
      const room = await appContext.roomService.createRoom(session.get('user'))
      next(null, { code: 200, data: { room } })
    } catch (error) {
      const code = error.message === '用户未登录' ? 401 : 400
      next(null, { code, error: error.message })
    }
  }

  /**
   * 加入房间
   */
  async joinRoom(msg, session, next) {
    try {
      const room = await appContext.roomService.joinRoom(session.get('user'), msg.roomId)
      next(null, { code: 200, data: { room } })
    } catch (error) {
      const code = error.message === '用户未登录' ? 401 : error.message === '房间不存在' ? 404 : 400
      next(null, { code, error: error.message })
    }
  }

  /**
   * 离开房间
   */
  async leaveRoom(msg, session, next) {
    try {
      await appContext.roomService.leaveRoom(session.get('user'), msg.roomId)
      next(null, { code: 200, data: { success: true } })
    } catch (error) {
      const code = error.message === '用户未登录' ? 401 : error.message === '房间不存在' ? 404 : 400
      next(null, { code, error: error.message })
    }
  }

  /**
   * 获取房间列表
   */
  async getRoomList(msg, session, next) {
    const rooms = appContext.roomService.getRoomList()
    next(null, { code: 200, data: { rooms } })
  }

  /**
   * 广播消息到房间内所有玩家
   */
  broadcastToRoom(roomId, event, data) {
    const room = appContext.roomRepository.get(roomId)
    appContext.broadcaster.broadcast(room, event, data)
  }

  /**
   * 清理用户的房间状态
   */
  async cleanupUserFromRooms(userId) {
    await appContext.roomService.cleanupUserFromRooms(userId)
  }
}

module.exports.rooms = appContext.roomRepository.rooms

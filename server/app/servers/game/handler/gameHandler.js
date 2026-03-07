const { appContext } = require('../../../../src/application/appContext')

module.exports = function(app) {
  return new Handler(app)
}

class Handler {
  constructor(app) {
    this.app = app
  }

  /**
   * 开始游戏
   */
  async startGame(msg, session, next) {
    try {
      const gameState = await appContext.gameService.startGame(session.get('user'), msg.roomId)
      next(null, { code: 200, data: { gameState } })
    } catch (error) {
      const code = error.message === '用户未登录' ? 401 : error.message === '房间不存在' ? 404 : 400
      next(null, { code, error: error.message })
    }
  }

  /**
   * 选择手牌
   */
  async selectCards(msg, session, next) {
    try {
      const gameState = await appContext.gameService.selectCards(
        session.get('user'),
        msg.roomId,
        msg.round,
        msg.selectedCards,
      )
      next(null, { code: 200, data: { gameState } })
    } catch (error) {
      const code = error.message === '用户未登录' ? 401 : error.message === '游戏不存在' ? 404 : 400
      next(null, { code, error: error.message })
    }
  }

  async restartGame(msg, session, next) {
    try {
      const gameState = await appContext.gameService.restartGame(session.get('user'), msg.roomId)
      next(null, { code: 200, data: { gameState } })
    } catch (error) {
      const code = error.message === '用户未登录' ? 401 : error.message === '房间不存在' ? 404 : 400
      next(null, { code, error: error.message })
    }
  }
}

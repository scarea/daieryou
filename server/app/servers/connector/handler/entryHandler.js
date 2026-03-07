const { appContext } = require('../../../../src/application/appContext')

module.exports = function(app) {
  return new Handler(app)
}

class Handler {
  constructor(app) {
    this.app = app
  }

  async getAuthConfig(msg, session, next) {
    try {
      const payload = await appContext.accountAuthService.getAuthConfig(session.get('user'))
      next(null, { code: 200, data: payload })
    } catch (error) {
      next(null, { code: 500, error: error.message })
    }
  }

  async sendEmailCode(msg, session, next) {
    try {
      const payload = await appContext.accountAuthService.sendEmailCode(msg?.email)
      next(null, { code: 200, data: payload })
    } catch (error) {
      next(null, { code: 400, error: error.message })
    }
  }

  async register(msg, session, next) {
    try {
      const payload = await appContext.accountAuthService.register({
        email: msg?.email,
        password: msg?.password,
        verificationCode: msg?.verificationCode,
        username: msg?.username,
        inviteCode: msg?.inviteCode,
      }, session)
      next(null, { code: 200, data: payload })
    } catch (error) {
      next(null, { code: 400, error: error.message })
    }
  }

  async loginWithPassword(msg, session, next) {
    try {
      const payload = await appContext.accountAuthService.loginWithPassword({
        email: msg?.email,
        password: msg?.password,
      }, session)
      next(null, { code: 200, data: payload })
    } catch (error) {
      next(null, { code: 401, error: error.message })
    }
  }

  async createInviteCode(msg, session, next) {
    try {
      const payload = await appContext.accountAuthService.createInviteCode(session.get('user'), {
        channel: msg?.channel,
        campaign: msg?.campaign,
        remark: msg?.remark,
      })
      next(null, { code: 200, data: payload })
    } catch (error) {
      const code = error.message === '用户未登录' ? 401 : 400
      next(null, { code, error: error.message })
    }
  }

  async purchaseMembership(msg, session, next) {
    try {
      const payload = await appContext.accountAuthService.purchaseMembership(
        session.get('user'),
        { planDays: msg?.planDays },
      )
      next(null, { code: 200, data: payload })
    } catch (error) {
      const code = error.message === '用户未登录' ? 401 : 400
      next(null, { code, error: error.message })
    }
  }

  async adminGrantMembership(msg, session, next) {
    try {
      const payload = await appContext.accountAuthService.adminGrantMembership(
        session.get('user'),
        {
          targetEmail: msg?.targetEmail,
          durationDays: msg?.durationDays,
          reason: msg?.reason,
        },
      )
      next(null, { code: 200, data: payload })
    } catch (error) {
      const code = error.message === '用户未登录' ? 401 : 400
      next(null, { code, error: error.message })
    }
  }

  async adminListInviteCodes(msg, session, next) {
    try {
      const payload = await appContext.accountAuthService.adminListInviteCodes(
        session.get('user'),
        {
          limit: msg?.limit,
          status: msg?.status,
        },
      )
      next(null, { code: 200, data: payload })
    } catch (error) {
      const code = error.message === '用户未登录' ? 401 : 400
      next(null, { code, error: error.message })
    }
  }

  async adminDisableInviteCode(msg, session, next) {
    try {
      const payload = await appContext.accountAuthService.adminDisableInviteCode(
        session.get('user'),
        {
          code: msg?.code,
          reason: msg?.reason,
        },
      )
      next(null, { code: 200, data: payload })
    } catch (error) {
      const code = error.message === '用户未登录' ? 401 : 400
      next(null, { code, error: error.message })
    }
  }

  async adminListAuditLogs(msg, session, next) {
    try {
      const payload = await appContext.accountAuthService.adminListAuditLogs(
        session.get('user'),
        {
          limit: msg?.limit,
          action: msg?.action,
        },
      )
      next(null, { code: 200, data: payload })
    } catch (error) {
      const code = error.message === '用户未登录' ? 401 : 400
      next(null, { code, error: error.message })
    }
  }

  async getBattleStats(msg, session, next) {
    try {
      const payload = await appContext.battleRecordService.getBattleStats(
        session.get('user'),
        {
          limit: msg?.limit,
          page: msg?.page,
          roomId: msg?.roomId,
          rank: msg?.rank,
          startTime: msg?.startTime,
          endTime: msg?.endTime,
        },
      )
      next(null, { code: 200, data: payload })
    } catch (error) {
      const code = error.message === '用户未登录' ? 401 : 400
      next(null, { code, error: error.message })
    }
  }

  async login(msg, session, next) {
    try {
      const payload = await appContext.authService.login(msg?.username, session, msg?.sessionToken)
      next(null, { code: 200, data: payload })
    } catch (error) {
      const code = error.message === '会话已失效，请重新登录' ? 401 : 400
      next(null, { code, error: error.message })
    }
  }

  async disconnect(msg, session, next) {
    await appContext.authService.disconnect(session)
    next()
  }
}

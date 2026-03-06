class SessionRepository {
  constructor() {
    this.sessions = new Map()
    this.userSessions = new Map()
  }

  add(session) {
    this.sessions.set(session.id, session)
  }

  remove(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return null
    }

    this.sessions.delete(sessionId)
    if (session.uid && this.userSessions.get(session.uid)?.id === session.id) {
      this.userSessions.delete(session.uid)
    }

    return session
  }

  bindUser(session, userId) {
    const previousSession = this.userSessions.get(userId)
    if (previousSession && previousSession.id !== session.id) {
      previousSession.superseded = true
      if (previousSession.ws && previousSession.ws.readyState < 2) {
        previousSession.ws.close()
      }
    }

    session.uid = userId
    this.userSessions.set(userId, session)
    return previousSession || null
  }

  getByUserId(userId) {
    return this.userSessions.get(userId) || null
  }

  forEachBoundUser(callback) {
    this.userSessions.forEach((session, userId) => {
      callback(session, userId)
    })
  }
}

module.exports = { SessionRepository }

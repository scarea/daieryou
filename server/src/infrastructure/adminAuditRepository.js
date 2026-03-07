const mongoose = require('mongoose')

const adminAuditSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  actorUserId: {
    type: String,
    default: null,
    index: true,
  },
  actorEmail: {
    type: String,
    default: null,
    index: true,
  },
  targetUserId: {
    type: String,
    default: null,
    index: true,
  },
  targetEmail: {
    type: String,
    default: null,
    index: true,
  },
  source: {
    type: String,
    default: 'system',
    index: true,
  },
  detail: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  createdAt: {
    type: Number,
    required: true,
    index: true,
  },
}, {
  versionKey: false,
  collection: 'admin_audit_logs',
})

const AdminAuditModel = mongoose.models.DaieryouAdminAudit
  || mongoose.model('DaieryouAdminAudit', adminAuditSchema)

function normalizeMongooseDocument(document) {
  if (!document) {
    return null
  }

  const object = typeof document.toObject === 'function'
    ? document.toObject()
    : document
  const { _id, ...rest } = object
  return rest
}

class AdminAuditRepository {
  normalizeText(value, maxLength = 120) {
    if (typeof value !== 'string') {
      return ''
    }

    return value.trim().slice(0, maxLength)
  }

  normalizeEmail(value) {
    const normalized = this.normalizeText(value, 120)
    return normalized ? normalized.toLowerCase() : ''
  }

  ensureDatabaseReady() {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('审计日志系统暂不可用，请检查 MongoDB 连接')
    }
  }

  normalizeDetail(detail) {
    if (!detail || typeof detail !== 'object') {
      return {}
    }

    try {
      const serialized = JSON.stringify(detail)
      const parsed = JSON.parse(serialized)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      return {}
    }
  }

  async createLog({
    action,
    actorUserId = null,
    actorEmail = null,
    targetUserId = null,
    targetEmail = null,
    source = 'system',
    detail = {},
    createdAt = Date.now(),
  }) {
    this.ensureDatabaseReady()

    const normalizedAction = this.normalizeText(action, 64)
    if (!normalizedAction) {
      throw new Error('审计动作不能为空')
    }

    const entry = await AdminAuditModel.create({
      action: normalizedAction,
      actorUserId: this.normalizeText(actorUserId, 64) || null,
      actorEmail: this.normalizeEmail(actorEmail) || null,
      targetUserId: this.normalizeText(targetUserId, 64) || null,
      targetEmail: this.normalizeEmail(targetEmail) || null,
      source: this.normalizeText(source, 32) || 'system',
      detail: this.normalizeDetail(detail),
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    })

    return normalizeMongooseDocument(entry)
  }

  async listLogs({ limit = 50, action = null } = {}) {
    this.ensureDatabaseReady()

    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)))
    const normalizedAction = this.normalizeText(action, 64)
    const query = normalizedAction ? { action: normalizedAction } : {}

    const rows = await AdminAuditModel.find(query)
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean()
      .exec()

    return rows.map((row) => normalizeMongooseDocument(row))
  }
}

module.exports = { AdminAuditRepository }

const mongoose = require('mongoose')

const inviteCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    index: true,
    unique: true,
  },
  creatorUserId: {
    type: String,
    required: true,
    index: true,
  },
  channel: {
    type: String,
    default: 'member',
    index: true,
  },
  campaign: {
    type: String,
    default: '',
  },
  remark: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['active', 'used', 'expired', 'disabled'],
    default: 'active',
    index: true,
  },
  expiresAt: {
    type: Number,
    required: true,
    index: true,
  },
  usedCount: {
    type: Number,
    default: 0,
  },
  maxUses: {
    type: Number,
    default: 1,
  },
  usedByUserId: {
    type: String,
    default: null,
  },
  usedByEmail: {
    type: String,
    default: null,
  },
  usedAt: {
    type: Number,
    default: null,
  },
  disabledByUserId: {
    type: String,
    default: null,
  },
  disabledReason: {
    type: String,
    default: null,
  },
  createdAt: {
    type: Number,
    required: true,
  },
  updatedAt: {
    type: Number,
    required: true,
  },
}, {
  versionKey: false,
  collection: 'invite_codes',
})

const InviteCodeModel = mongoose.models.DaieryouInviteCode || mongoose.model('DaieryouInviteCode', inviteCodeSchema)

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

class InviteCodeRepository {
  normalizeCode(code) {
    if (typeof code !== 'string') {
      return ''
    }

    return code.trim().toUpperCase()
  }

  normalizeText(value, maxLength = 64) {
    if (typeof value !== 'string') {
      return ''
    }

    return value.trim().slice(0, maxLength)
  }

  ensureDatabaseReady() {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('邀请码系统暂不可用，请检查 MongoDB 连接')
    }
  }

  async createInviteCode({
    code,
    creatorUserId,
    expiresAt,
    maxUses = 1,
    channel = 'member',
    campaign = '',
    remark = '',
    createdAt = Date.now(),
  }) {
    this.ensureDatabaseReady()

    const normalizedCode = this.normalizeCode(code)
    if (!normalizedCode) {
      throw new Error('邀请码不能为空')
    }
    if (typeof creatorUserId !== 'string' || !creatorUserId.trim()) {
      throw new Error('邀请码创建者不能为空')
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= createdAt) {
      throw new Error('邀请码有效期无效')
    }

    try {
      const inviteCode = await InviteCodeModel.create({
        code: normalizedCode,
        creatorUserId: creatorUserId.trim(),
        channel: this.normalizeText(channel, 32) || 'member',
        campaign: this.normalizeText(campaign, 64),
        remark: this.normalizeText(remark, 120),
        status: 'active',
        expiresAt,
        usedCount: 0,
        maxUses: Math.max(1, Math.floor(maxUses)),
        usedByUserId: null,
        usedByEmail: null,
        usedAt: null,
        disabledByUserId: null,
        disabledReason: null,
        createdAt,
        updatedAt: createdAt,
      })
      return normalizeMongooseDocument(inviteCode)
    } catch (error) {
      if (error?.code === 11000) {
        const conflictError = new Error('邀请码重复')
        conflictError.code = 'INVITE_CODE_DUPLICATED'
        throw conflictError
      }

      throw error
    }
  }

  async findByCode(code) {
    this.ensureDatabaseReady()
    const normalizedCode = this.normalizeCode(code)
    if (!normalizedCode) {
      return null
    }

    const inviteCode = await InviteCodeModel.findOne({ code: normalizedCode }).lean().exec()
    return normalizeMongooseDocument(inviteCode)
  }

  async consumeActiveCode(code, { userId = null, email = null, now = Date.now() } = {}) {
    this.ensureDatabaseReady()
    const normalizedCode = this.normalizeCode(code)
    if (!normalizedCode) {
      return null
    }

    const consumed = await InviteCodeModel.findOneAndUpdate({
      code: normalizedCode,
      status: 'active',
      expiresAt: { $gt: now },
      $expr: { $lt: ['$usedCount', '$maxUses'] },
    }, {
      $set: {
        status: 'used',
        updatedAt: now,
        usedByUserId: typeof userId === 'string' && userId.trim() ? userId.trim() : null,
        usedByEmail: typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null,
        usedAt: now,
      },
      $inc: {
        usedCount: 1,
      },
    }, {
      new: true,
      lean: true,
    }).exec()

    return normalizeMongooseDocument(consumed)
  }

  async rollbackConsume(code, { now = Date.now() } = {}) {
    this.ensureDatabaseReady()
    const normalizedCode = this.normalizeCode(code)
    if (!normalizedCode) {
      return null
    }

    const rolledBack = await InviteCodeModel.findOneAndUpdate({
      code: normalizedCode,
      status: 'used',
      usedCount: { $gte: 1 },
    }, {
      $set: {
        status: 'active',
        updatedAt: now,
        usedByUserId: null,
        usedByEmail: null,
        usedAt: null,
        disabledByUserId: null,
        disabledReason: null,
      },
      $inc: {
        usedCount: -1,
      },
    }, {
      new: true,
      lean: true,
    }).exec()

    return normalizeMongooseDocument(rolledBack)
  }

  async listInviteCodes({ limit = 50, status = null } = {}) {
    this.ensureDatabaseReady()

    const safeLimit = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)))
    const query = {}
    const normalizedStatus = this.normalizeText(status, 32)
    if (normalizedStatus) {
      query.status = normalizedStatus
    }

    const records = await InviteCodeModel.find(query)
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean()
      .exec()

    return records.map((record) => normalizeMongooseDocument(record))
  }

  async disableCode(code, { reason = '', disabledByUserId = null, now = Date.now() } = {}) {
    this.ensureDatabaseReady()
    const normalizedCode = this.normalizeCode(code)
    if (!normalizedCode) {
      return null
    }

    const normalizedReason = this.normalizeText(reason, 120)
    const normalizedDisabledByUserId = this.normalizeText(disabledByUserId, 64) || null

    const disabled = await InviteCodeModel.findOneAndUpdate({
      code: normalizedCode,
      status: { $in: ['active', 'used', 'expired'] },
    }, {
      $set: {
        status: 'disabled',
        updatedAt: now,
        disabledReason: normalizedReason || null,
        disabledByUserId: normalizedDisabledByUserId,
      },
    }, {
      new: true,
      lean: true,
    }).exec()

    return normalizeMongooseDocument(disabled)
  }
}

module.exports = { InviteCodeRepository }

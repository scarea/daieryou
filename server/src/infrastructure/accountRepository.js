const mongoose = require('mongoose')

const accountSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true,
    unique: true,
  },
  userId: {
    type: String,
    required: true,
    index: true,
    unique: true,
  },
  username: {
    type: String,
    required: true,
    trim: true,
  },
  passwordSalt: {
    type: String,
    required: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  verifiedAt: {
    type: Number,
    required: true,
  },
  createdAt: {
    type: Number,
    required: true,
  },
  updatedAt: {
    type: Number,
    required: true,
  },
  lastLoginAt: {
    type: Number,
    default: null,
  },
  isMember: {
    type: Boolean,
    default: false,
    index: true,
  },
  isAdmin: {
    type: Boolean,
    default: false,
    index: true,
  },
  memberExpiresAt: {
    type: Number,
    default: null,
  },
  invitedByUserId: {
    type: String,
    default: null,
  },
}, {
  versionKey: false,
  collection: 'accounts',
})

const AccountModel = mongoose.models.DaieryouAccount || mongoose.model('DaieryouAccount', accountSchema)

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

class AccountRepository {
  normalizeEmail(email) {
    if (typeof email !== 'string') {
      return ''
    }

    return email.trim().toLowerCase()
  }

  ensureDatabaseReady() {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('账号系统暂不可用，请检查 MongoDB 连接')
    }
  }

  async findByEmail(email) {
    this.ensureDatabaseReady()
    const normalizedEmail = this.normalizeEmail(email)
    if (!normalizedEmail) {
      return null
    }

    const account = await AccountModel.findOne({ email: normalizedEmail }).lean().exec()
    return normalizeMongooseDocument(account)
  }

  async findByUserId(userId) {
    this.ensureDatabaseReady()
    if (typeof userId !== 'string' || !userId.trim()) {
      return null
    }

    const account = await AccountModel.findOne({ userId: userId.trim() }).lean().exec()
    return normalizeMongooseDocument(account)
  }

  async create(account) {
    this.ensureDatabaseReady()
    const normalizedEmail = this.normalizeEmail(account?.email)
    if (!normalizedEmail) {
      throw new Error('邮箱不能为空')
    }

    const now = Date.now()
    const nextAccount = {
      ...account,
      email: normalizedEmail,
      createdAt: account?.createdAt || now,
      updatedAt: now,
      lastLoginAt: account?.lastLoginAt || null,
      isMember: account?.isMember === true,
      isAdmin: account?.isAdmin === true,
      memberExpiresAt: Number.isFinite(account?.memberExpiresAt) ? account.memberExpiresAt : null,
      invitedByUserId: account?.invitedByUserId || null,
    }

    try {
      const created = await AccountModel.create(nextAccount)
      return normalizeMongooseDocument(created)
    } catch (error) {
      if (error?.code === 11000) {
        throw new Error('该邮箱已注册')
      }

      throw error
    }
  }

  async updateByEmail(email, updates = {}) {
    this.ensureDatabaseReady()
    const normalizedEmail = this.normalizeEmail(email)
    if (!normalizedEmail) {
      return null
    }

    const nextAccount = await AccountModel.findOneAndUpdate({
      email: normalizedEmail,
    }, {
      ...updates,
      updatedAt: Date.now(),
    }, {
      new: true,
      lean: true,
    }).exec()

    return normalizeMongooseDocument(nextAccount)
  }
}

module.exports = { AccountRepository }

// 用户系统与积分系统：注册 / 登录 / 游客 / 会话、签到、救济金、对局结算。
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import {
  AVATARS, Hall, RELIEF_AMOUNT, RELIEF_DAILY_LIMIT, RELIEF_THRESHOLD, SIGNIN_REWARDS, START_COINS,
  expGain, honorDelta,
} from '../shared/economy.ts'
import { finalPlacements } from '../shared/engine.ts'
import { ACHIEVEMENTS, DAILY_TASKS, GrowthItem, GrowthStats, growthItems, seasonDaysLeft, seasonId, seasonReset } from '../shared/growth.ts'
import { ShopKind, shopItem } from '../shared/shop.ts'
import type { SettlementEntry, SigninStatus, UserProfile } from '../shared/protocol.ts'
import { MatchDetail, Store, StoreStats, UserRow, parseList, toProfile } from './store.ts'

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000
const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/
const LOCK_AFTER_FAILURES = 5
const LOCK_MS = 5 * 60 * 1000
/** 游客起步金币少一些，绑定账号后补齐 */
export const GUEST_START_COINS = 3000
const BIND_BONUS = START_COINS - GUEST_START_COINS
/** 同一 IP 24 小时内最多创建的游客 / 正式账号数 */
const MAX_ACCOUNTS_PER_IP = 6
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function newRecoveryCode(): { code: string; hash: string } {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(12)
  const chars = Array.from(bytes, (byte) => alphabet[byte % alphabet.length])
  const code = `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`
  return { code, hash: hashRecovery(code) }
}

function hashRecovery(code: string): string {
  return createHash('sha256').update(code.toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest()
  const right = createHash('sha256').update(b).digest()
  return timingSafeEqual(left, right)
}

/** 可直接展示给用户的业务错误 */
export class AppError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const HASH_PREFIX = 'pbkdf2_sha256'

/** PBKDF2-SHA256（WebCrypto，Node 与 Cloudflare Workers 通用）。迭代次数随哈希一起存储，可随时调整。 */
async function pbkdf2(password: string, salt: string, iterations: number): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations }, key, 256)
  return Buffer.from(bits).toString('hex')
}

async function hashPassword(password: string, salt: string, iterations: number): Promise<string> {
  return `${HASH_PREFIX}$${iterations}$${await pbkdf2(password, salt, iterations)}`
}

async function verifyPassword(password: string, salt: string, stored: string): Promise<boolean> {
  const [prefix, iterationText, digest] = stored.split('$')
  const iterations = Number(iterationText)
  if (prefix !== HASH_PREFIX || !Number.isInteger(iterations) || iterations <= 0 || !digest) return false
  const actual = Buffer.from(await pbkdf2(password, salt, iterations), 'hex')
  const expected = Buffer.from(digest, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** 以东八区自然日为签到 / 救济的"天" */
export function dayNumber(now = Date.now()): number {
  return Math.floor((now + 8 * 3600 * 1000) / 86400000)
}

function cleanNickname(input: unknown, fallback: string): string {
  const text = String(input ?? '').replace(/\s+/g, ' ').trim()
  const chars = Array.from(text)
  if (chars.length === 0) return fallback
  if (chars.length > 12) throw new AppError('昵称最多 12 个字')
  return text
}

function cleanAvatar(input: unknown): number {
  const value = Number(input)
  return Number.isInteger(value) && value >= 0 && value < AVATARS.length ? value : 0
}

export interface MatchPlayerInput {
  seat: number
  userId: string
  nickname: string
  avatar: number
  isBot: boolean
  total: number
  caught: number
  leopards: number
}

export class Accounts {
  private failures = new Map<string, { count: number; lockedUntil: number }>()

  constructor(readonly store: Store, private hashIterations = 120000, private adminKey = '') {}

  /** 防刷：同一 IP 短时间内不能批量建号（本机回环地址不限） */
  private async checkIp(ip: string | undefined, guest: boolean): Promise<string | null> {
    if (!ip || LOOPBACK.has(ip)) return null
    const count = await this.store.countUsersByIp(ip, Date.now() - 24 * 3600 * 1000, guest)
    if (count >= MAX_ACCOUNTS_PER_IP) {
      throw new AppError(guest ? '今日游客试玩次数已达上限，请注册账号后继续' : '今日注册次数已达上限，请明天再试', 429)
    }
    return ip
  }

  private noteFailure(key: string): void {
    const count = (this.failures.get(key)?.count ?? 0) + 1
    this.failures.set(key, { count, lockedUntil: count >= LOCK_AFTER_FAILURES ? Date.now() + LOCK_MS : 0 })
  }

  private checkLock(key: string): void {
    const failure = this.failures.get(key)
    if (failure && failure.lockedUntil > Date.now()) {
      throw new AppError(`尝试次数过多，请 ${Math.ceil((failure.lockedUntil - Date.now()) / 60000)} 分钟后再试`, 429)
    }
  }

  // ------------------------------ 账号 ------------------------------

  private async issueSession(userId: string): Promise<string> {
    const token = randomBytes(32).toString('hex')
    await this.store.insertSession(hashToken(token), userId, Date.now() + SESSION_TTL_MS)
    return token
  }

  private validateCredentials(username: unknown, password: unknown): { username: string; password: string } {
    const name = String(username ?? '').trim()
    const pass = String(password ?? '')
    if (!USERNAME_RE.test(name)) throw new AppError('账号需为 3~16 位字母、数字或下划线')
    if (pass.length < 6 || pass.length > 64) throw new AppError('密码长度需为 6~64 位')
    return { username: name, password: pass }
  }

  async register(input: { username?: unknown; password?: unknown; nickname?: unknown; avatar?: unknown }, ip?: string): Promise<{ token: string; user: UserProfile; recoveryCode: string }> {
    const { username, password } = this.validateCredentials(input.username, input.password)
    if (await this.store.getUserByUsername(username)) throw new AppError('该账号已被注册')
    const regIp = await this.checkIp(ip, false)
    const recovery = newRecoveryCode()
    const salt = randomBytes(16).toString('hex')
    const id = randomUUID()
    const nickname = cleanNickname(input.nickname, username)
    const passHash = await hashPassword(password, salt, this.hashIterations)
    await this.store.tx(async (tx) => {
      await tx.insertUser({
        id, username, pass_hash: passHash, pass_salt: salt, nickname, avatar: cleanAvatar(input.avatar), is_guest: 0, coins: 0,
        reg_ip: regIp, recovery_hash: recovery.hash,
      })
      await tx.addCoins(id, START_COINS, '新人礼金')
    })
    return { token: await this.issueSession(id), user: await this.profile(id), recoveryCode: recovery.code }
  }

  async login(input: { username?: unknown; password?: unknown }): Promise<{ token: string; user: UserProfile }> {
    const username = String(input.username ?? '').trim()
    const password = String(input.password ?? '')
    const key = username.toLowerCase()
    this.checkLock(key)
    const user = username ? await this.store.getUserByUsername(username) : undefined
    const ok = Boolean(user?.pass_hash && user.pass_salt && await verifyPassword(password, user.pass_salt, user.pass_hash))
    if (!user || !ok) {
      this.noteFailure(key)
      throw new AppError('账号或密码不正确', 401)
    }
    if (user.banned) throw new AppError('该账号已被封禁，如有疑问请联系管理员', 403)
    this.failures.delete(key)
    await this.store.updateUser(user.id, { last_login_at: Date.now() })
    return { token: await this.issueSession(user.id), user: await this.profile(user.id) }
  }

  async guest(input: { avatar?: unknown } = {}, ip?: string): Promise<{ token: string; user: UserProfile }> {
    const regIp = await this.checkIp(ip, true)
    const id = randomUUID()
    const nickname = `游客${Math.floor(1000 + Math.random() * 9000)}`
    await this.store.tx(async (tx) => {
      await tx.insertUser({
        id,
        username: null,
        pass_hash: null,
        pass_salt: null,
        nickname,
        avatar: input.avatar === undefined ? Math.floor(Math.random() * AVATARS.length) : cleanAvatar(input.avatar),
        is_guest: 1,
        coins: 0,
        reg_ip: regIp,
      })
      await tx.addCoins(id, GUEST_START_COINS, '游客礼金')
    })
    return { token: await this.issueSession(id), user: await this.profile(id) }
  }

  /** 游客绑定账号密码，保留全部资产与战绩 */
  async upgrade(userId: string, input: { username?: unknown; password?: unknown; nickname?: unknown }): Promise<{ user: UserProfile; recoveryCode: string }> {
    const user = await this.requireUser(userId)
    if (!user.is_guest) throw new AppError('当前账号已是正式账号')
    const { username, password } = this.validateCredentials(input.username, input.password)
    if (await this.store.getUserByUsername(username)) throw new AppError('该账号已被注册')
    const salt = randomBytes(16).toString('hex')
    const recovery = newRecoveryCode()
    const nickname = cleanNickname(input.nickname, user.nickname.startsWith('游客') ? username : user.nickname)
    const passHash = await hashPassword(password, salt, this.hashIterations)
    await this.store.tx(async (tx) => {
      await tx.updateUser(userId, { username, pass_hash: passHash, pass_salt: salt, is_guest: 0, nickname, recovery_hash: recovery.hash })
      await tx.addCoins(userId, BIND_BONUS, '绑定账号奖励')
    })
    return { user: await this.profile(userId), recoveryCode: recovery.code }
  }

  async logout(token: string): Promise<void> {
    await this.store.deleteSession(hashToken(token))
  }

  async authenticate(token: unknown): Promise<UserRow | undefined> {
    if (typeof token !== 'string' || token.length < 16) return undefined
    const userId = await this.store.getSessionUserId(hashToken(token))
    const user = userId ? await this.store.getUser(userId) : undefined
    return user && !user.banned ? user : undefined
  }

  async requireUser(userId: string): Promise<UserRow> {
    const user = await this.store.getUser(userId)
    if (!user) throw new AppError('用户不存在', 404)
    return user
  }

  async profile(userId: string): Promise<UserProfile> {
    return toProfile(await this.requireUser(userId))
  }

  async updateProfile(userId: string, input: { nickname?: unknown; avatar?: unknown }): Promise<UserProfile> {
    const user = await this.requireUser(userId)
    await this.store.updateUser(userId, {
      nickname: input.nickname === undefined ? user.nickname : cleanNickname(input.nickname, user.nickname),
      avatar: input.avatar === undefined ? user.avatar : cleanAvatar(input.avatar),
    })
    return this.profile(userId)
  }

  // ------------------------------ 签到 / 救济 ------------------------------

  async signinStatus(userId: string): Promise<SigninStatus> {
    const user = await this.requireUser(userId)
    const today = dayNumber()
    const signedToday = user.signin_day === today
    const continued = signedToday || user.signin_day === today - 1
    const streak = continued ? user.signin_streak : 0
    const reliefUsed = user.relief_day === today ? user.relief_count : 0
    return {
      signedToday,
      streak,
      nextIndex: (signedToday ? streak - 1 : streak) % SIGNIN_REWARDS.length,
      reliefLeft: Math.max(0, RELIEF_DAILY_LIMIT - reliefUsed),
    }
  }

  async signin(userId: string): Promise<{ reward: number; status: SigninStatus; user: UserProfile }> {
    const before = await this.signinStatus(userId)
    if (before.signedToday) throw new AppError('今日已签到，明天再来')
    const reward = SIGNIN_REWARDS[before.nextIndex]
    await this.store.tx(async (tx) => {
      await tx.updateUser(userId, { signin_day: dayNumber(), signin_streak: before.streak + 1 })
      await tx.addCoins(userId, reward, `每日签到 · 第${before.nextIndex + 1}天`)
    })
    return { reward, status: await this.signinStatus(userId), user: await this.profile(userId) }
  }

  async relief(userId: string): Promise<{ reward: number; status: SigninStatus; user: UserProfile }> {
    const user = await this.requireUser(userId)
    const status = await this.signinStatus(userId)
    if (user.coins >= RELIEF_THRESHOLD) throw new AppError(`金币低于 ${RELIEF_THRESHOLD} 时才能领取救济金`)
    if (status.reliefLeft <= 0) throw new AppError('今日救济金已领完，明天再来')
    const today = dayNumber()
    await this.store.tx(async (tx) => {
      await tx.updateUser(userId, {
        relief_day: today,
        relief_count: (user.relief_day === today ? user.relief_count : 0) + 1,
      })
      await tx.addCoins(userId, RELIEF_AMOUNT, '财神救济金')
    })
    return { reward: RELIEF_AMOUNT, status: await this.signinStatus(userId), user: await this.profile(userId) }
  }

  // ------------------------------ 找回密码（恢复码） ------------------------------

  /** 重新生成恢复码（旧码立即失效）；恢复码只在生成时展示一次 */
  async regenerateRecovery(userId: string): Promise<{ recoveryCode: string }> {
    const user = await this.requireUser(userId)
    if (user.is_guest) throw new AppError('请先绑定账号')
    const recovery = newRecoveryCode()
    await this.store.updateUser(userId, { recovery_hash: recovery.hash })
    return { recoveryCode: recovery.code }
  }

  /** 凭账号 + 恢复码重设密码；成功后所有设备下线，并换发新的恢复码 */
  async resetPassword(input: { username?: unknown; recoveryCode?: unknown; password?: unknown }): Promise<{ recoveryCode: string }> {
    const { username, password } = this.validateCredentials(input.username, input.password)
    const key = `reset:${username.toLowerCase()}`
    this.checkLock(key)
    const user = await this.store.getUserByUsername(username)
    const code = String(input.recoveryCode ?? '')
    if (!user?.recovery_hash || !safeEqual(hashRecovery(code), user.recovery_hash)) {
      this.noteFailure(key)
      throw new AppError('账号或恢复码不正确', 401)
    }
    this.failures.delete(key)
    this.failures.delete(username.toLowerCase())
    const salt = randomBytes(16).toString('hex')
    const recovery = newRecoveryCode()
    await this.store.updateUser(user.id, {
      pass_hash: await hashPassword(password, salt, this.hashIterations), pass_salt: salt, recovery_hash: recovery.hash,
    })
    await this.store.deleteUserSessions(user.id)
    return { recoveryCode: recovery.code }
  }

  // ------------------------------ 赛季 / 每日任务 / 成就 ------------------------------

  /** 进入新赛季：按上赛季爵位发奖，荣誉分保留四成。返回本次发放的奖励（没有换季则为 null）。 */
  async touchSeason(userId: string): Promise<{ title: string; reward: number } | null> {
    const user = await this.requireUser(userId)
    const current = seasonId()
    if (user.season === current) return null
    if (!user.season) {
      await this.store.updateUser(userId, { season: current })
      return null
    }
    const reset = seasonReset(user.honor)
    await this.store.tx(async (tx) => {
      await tx.updateUser(userId, { season: current, honor: reset.honor })
      if (reset.reward > 0) await tx.addCoins(userId, reset.reward, `赛季结算 · ${reset.title}`)
    })
    return reset.reward > 0 || user.honor > 0 ? { title: reset.title, reward: reset.reward } : null
  }

  private growthStats(user: UserRow): GrowthStats {
    const today = dayNumber()
    const sameDay = user.day_key === today
    return {
      games: user.games,
      wins: user.wins,
      leopards: user.leopards,
      bestWin: user.best_win,
      honor: user.honor,
      isGuest: user.is_guest === 1,
      dayGames: sameDay ? user.day_games : 0,
      dayWins: sameDay ? user.day_wins : 0,
      signedToday: user.signin_day === today,
    }
  }

  async growth(userId: string): Promise<{ tasks: GrowthItem[]; achievements: GrowthItem[]; season: { id: string; daysLeft: number } }> {
    const user = await this.requireUser(userId)
    const stats = this.growthStats(user)
    const dayClaimed = user.day_key === dayNumber() ? parseList(user.day_claimed) : []
    return {
      tasks: growthItems(DAILY_TASKS, stats, dayClaimed),
      achievements: growthItems(ACHIEVEMENTS, stats, parseList(user.ach_claimed)),
      season: { id: seasonId(), daysLeft: seasonDaysLeft() },
    }
  }

  async claimGrowth(userId: string, id: unknown): Promise<{ reward: number; user: UserProfile }> {
    const user = await this.requireUser(userId)
    const today = dayNumber()
    const task = DAILY_TASKS.find((def) => def.id === id)
    const def = task ?? ACHIEVEMENTS.find((item) => item.id === id)
    if (!def) throw new AppError('奖励不存在')
    const claimed = task ? (user.day_key === today ? parseList(user.day_claimed) : []) : parseList(user.ach_claimed)
    if (claimed.includes(def.id)) throw new AppError('该奖励已领取')
    if (def.progress(this.growthStats(user)) < def.target) throw new AppError('尚未达成，继续加油')
    const next = JSON.stringify([...claimed, def.id])
    await this.store.tx(async (tx) => {
      if (task) {
        await tx.updateUser(userId, user.day_key === today ? { day_claimed: next } : { day_key: today, day_games: 0, day_wins: 0, day_claimed: next })
      } else {
        await tx.updateUser(userId, { ach_claimed: next })
      }
      await tx.addCoins(userId, def.reward, `${task ? '每日任务' : '成就'} · ${def.title}`)
    })
    return { reward: def.reward, user: await this.profile(userId) }
  }

  // ------------------------------ 商城 ------------------------------

  async buyItem(userId: string, itemId: unknown): Promise<UserProfile> {
    const item = shopItem(String(itemId))
    if (!item) throw new AppError('商品不存在')
    await this.store.tx(async (tx) => {
      const user = await tx.getUser(userId)
      if (!user) throw new AppError('用户不存在', 404)
      const items = parseList(user.items)
      if (items.includes(item.id)) throw new AppError('你已拥有该物品')
      if (user.coins < item.price) throw new AppError('金币不足')
      await tx.addCoins(userId, -item.price, `商城购买 · ${item.name}`)
      await tx.updateUser(userId, { items: JSON.stringify([...items, item.id]), [item.kind]: item.id })
    })
    return this.profile(userId)
  }

  /** 装备已拥有的物品；itemId 为空串表示换回默认外观 */
  async equipItem(userId: string, kind: unknown, itemId: unknown): Promise<UserProfile> {
    if (kind !== 'frame' && kind !== 'cardback' && kind !== 'felt') throw new AppError('类型无效')
    const id = String(itemId ?? '')
    const user = await this.requireUser(userId)
    if (id) {
      const item = shopItem(id)
      if (!item || item.kind !== kind || !parseList(user.items).includes(id)) throw new AppError('尚未拥有该物品')
    }
    await this.store.updateUser(userId, { [kind as ShopKind]: id })
    return this.profile(userId)
  }

  // ------------------------------ 好友 ------------------------------

  async addFriend(userId: string, input: { userId?: unknown; username?: unknown }): Promise<void> {
    const target = typeof input.userId === 'string' && input.userId
      ? await this.store.getUser(input.userId)
      : await this.store.getUserByUsername(String(input.username ?? '').trim())
    if (!target) throw new AppError('没有找到这位玩家')
    if (target.id === userId) throw new AppError('不能添加自己')
    await this.store.addFriend(userId, target.id)
  }

  // ------------------------------ 运营后台 ------------------------------

  /** 用部署时配置的管理员口令，把当前账号设为管理员 */
  async claimAdmin(userId: string, key: unknown): Promise<UserProfile> {
    const lockKey = `admin:${userId}`
    this.checkLock(lockKey)
    const user = await this.requireUser(userId)
    if (user.is_guest) throw new AppError('请先绑定正式账号')
    if (!this.adminKey || typeof key !== 'string' || !safeEqual(key.trim(), this.adminKey)) {
      this.noteFailure(lockKey)
      throw new AppError('管理员口令不正确', 403)
    }
    await this.store.updateUser(userId, { is_admin: 1 })
    return this.profile(userId)
  }

  async requireAdmin(userId: string): Promise<UserRow> {
    const user = await this.requireUser(userId)
    if (!user.is_admin) throw new AppError('没有管理权限', 403)
    return user
  }

  adminStats(): Promise<StoreStats> {
    const now = Date.now() + 8 * 3600 * 1000
    return this.store.stats(now - (now % 86400000) - 8 * 3600 * 1000)
  }

  async adminGrant(adminId: string, userId: unknown, amount: unknown, reason: unknown): Promise<UserRow> {
    const delta = Math.trunc(Number(amount))
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 100000000) throw new AppError('金币数量无效')
    const target = await this.requireUser(String(userId))
    const admin = await this.requireUser(adminId)
    const note = String(reason ?? '').trim().slice(0, 30)
    await this.store.addCoins(target.id, delta, `运营${delta > 0 ? '发放' : '扣除'}${note ? ` · ${note}` : ''}（${admin.nickname}）`)
    return this.requireUser(target.id)
  }

  async adminBan(adminId: string, userId: unknown, banned: unknown): Promise<UserRow> {
    const target = await this.requireUser(String(userId))
    if (target.id === adminId) throw new AppError('不能封禁自己')
    if (target.is_admin) throw new AppError('不能封禁管理员')
    await this.store.updateUser(target.id, { banned: banned ? 1 : 0 })
    if (banned) await this.store.deleteUserSessions(target.id)
    return this.requireUser(target.id)
  }

  /** 管理员重置密码：返回一次性临时密码，由管理员转交给玩家 */
  async adminResetPassword(userId: unknown): Promise<{ password: string }> {
    const target = await this.requireUser(String(userId))
    if (target.is_guest) throw new AppError('游客账号没有密码')
    const password = randomBytes(6).toString('base64url')
    const salt = randomBytes(16).toString('hex')
    await this.store.updateUser(target.id, { pass_hash: await hashPassword(password, salt, this.hashIterations), pass_salt: salt })
    await this.store.deleteUserSessions(target.id)
    return { password }
  }

  // ------------------------------ 对局结算 ------------------------------

  /** 一局结束：按总分 × 底注结算金币，并更新荣誉、经验与生涯数据 */
  async settleMatch(hall: Hall, players: MatchPlayerInput[], rounds: MatchDetail['rounds']): Promise<SettlementEntry[]> {
    const placements = finalPlacements(players.map((player) => player.total))
    const lastPlacement = Math.max(...placements)
    const allTied = lastPlacement === 1
    const matchId = randomUUID()
    const finishedAt = Date.now()
    const today = dayNumber()
    for (const player of players) {
      if (!player.isBot) await this.touchSeason(player.userId).catch(() => null)
    }

    return this.store.tx(async (tx) => {
      const entries: SettlementEntry[] = []
      await tx.insertMatch({
        id: matchId,
        hallId: hall.id,
        stake: hall.stake,
        finishedAt,
        detail: {
          players: players.map((player) => ({
            userId: player.userId, nickname: player.nickname, avatar: player.avatar, total: player.total, isBot: player.isBot,
          })),
          rounds,
        },
      })
      for (const [index, player] of players.entries()) {
        const placement = placements[index]
        const honor = allTied ? 0 : honorDelta(placement, lastPlacement, hall)
        const exp = expGain(allTied ? 2 : placement, player.total)
        let coinsDelta = player.total * hall.stake
        let honorApplied = honor
        const user = player.isBot ? undefined : await tx.getUser(player.userId)
        if (user) {
          coinsDelta = await tx.addCoins(player.userId, coinsDelta, `${hall.name}对局 · ${player.total >= 0 ? '+' : ''}${player.total}分`)
          const nextHonor = Math.max(0, user.honor + honor)
          honorApplied = nextHonor - user.honor
          await tx.updateUser(player.userId, {
            honor: nextHonor,
            exp: user.exp + exp,
            games: user.games + 1,
            wins: user.wins + (placement === 1 && !allTied ? 1 : 0),
            caught: user.caught + player.caught,
            leopards: user.leopards + player.leopards,
            best_win: Math.max(user.best_win, coinsDelta),
            day_key: today,
            day_games: (user.day_key === today ? user.day_games : 0) + 1,
            day_wins: (user.day_key === today ? user.day_wins : 0) + (placement === 1 && !allTied ? 1 : 0),
            ...(user.day_key === today ? {} : { day_claimed: '[]' }),
          })
          await tx.insertMatchPlayer({
            matchId, userId: player.userId, seat: player.seat, placement, total: player.total,
            coinsDelta, honorDelta: honorApplied, finishedAt,
          })
        }
        entries.push({ seat: player.seat, total: player.total, placement, coinsDelta, honorDelta: honorApplied, expGain: exp })
      }
      return entries
    })
  }
}

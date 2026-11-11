import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { HALLS, RELIEF_AMOUNT, SIGNIN_REWARDS, START_COINS } from '../src/shared/economy.ts'
import type { RoomView, ServerEvent } from '../src/shared/protocol.ts'
import { Accounts, AppError } from '../src/server/accounts.ts'
import { decidePick } from '../src/server/bot.ts'
import { RoomManager, RoomTimings } from '../src/server/rooms.ts'
import { SqliteStore } from '../src/server/sqliteStore.ts'
import { createGame } from '../src/shared/engine.ts'

const FAST: RoomTimings = {
  pickMs: 400, finalMs: 10, showdownMs: 10, finalShowdownMs: 10, botMinMs: 1, botMaxMs: 5, offlineGraceMs: 20, idleKickMs: 50, matchMs: 40,
}

function setup() {
  const accounts = new Accounts(new SqliteStore(':memory:'), 1000)
  const online = new Set<string>()
  const lastRoom = new Map<string, RoomView | null>()
  const events: { userId: string; event: ServerEvent }[] = []
  const hub = {
    send(userId: string, event: ServerEvent) {
      events.push({ userId, event })
      if (event.ev === 'room') lastRoom.set(userId, event.room)
    },
    isOnline: (userId: string) => online.has(userId),
    onlineUserIds: () => [...online],
  }
  const rooms = new RoomManager(accounts, hub, FAST)
  const join = async (name: string) => {
    const { user } = await accounts.register({ username: name, password: 'secret123' })
    online.add(user.id)
    return user.id
  }
  return { accounts, rooms, online, lastRoom, events, join }
}

async function waitFor(check: () => boolean, ms = 5000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('等待超时')
    await sleep(5)
  }
}

test('注册 / 登录 / 游客 / 绑定', async () => {
  const { accounts } = setup()
  const { token, user } = await accounts.register({ username: 'Alice_01', password: 'secret123', nickname: '爱丽丝', avatar: 3 })
  assert.equal(user.coins, START_COINS)
  assert.equal(user.nickname, '爱丽丝')
  assert.equal((await accounts.authenticate(token))?.id, user.id)
  await assert.rejects(async () => await accounts.register({ username: 'alice_01', password: 'secret123' }), /已被注册/)
  await assert.rejects(async () => await accounts.register({ username: 'a', password: 'secret123' }), AppError)
  await assert.rejects(async () => await accounts.register({ username: 'bobby', password: '123' }), AppError)
  await assert.rejects(async () => await accounts.login({ username: 'Alice_01', password: 'wrong-pass' }), /不正确/)
  assert.equal((await accounts.login({ username: 'alice_01', password: 'secret123' })).user.id, user.id)
  await accounts.logout(token)
  assert.equal(await accounts.authenticate(token), undefined)

  const guest = await accounts.guest()
  assert.equal(guest.user.isGuest, true)
  const upgraded = await accounts.upgrade(guest.user.id, { username: 'guest_up', password: 'secret123' })
  assert.equal(upgraded.user.isGuest, false)
  assert.equal(upgraded.user.coins, START_COINS)
  assert.match(upgraded.recoveryCode, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  assert.equal((await accounts.login({ username: 'guest_up', password: 'secret123' })).user.id, guest.user.id)
})

test('连续输错密码后锁定', async () => {
  const { accounts } = setup()
  await accounts.register({ username: 'locker', password: 'secret123' })
  for (let i = 0; i < 5; i += 1) await assert.rejects(async () => await accounts.login({ username: 'locker', password: 'nope-nope' }))
  await assert.rejects(async () => await accounts.login({ username: 'locker', password: 'secret123' }), /尝试次数过多/)
})

test('签到与救济金', async () => {
  const { accounts } = setup()
  const { user } = await accounts.register({ username: 'signer', password: 'secret123' })
  assert.equal((await accounts.signinStatus(user.id)).signedToday, false)
  const first = await accounts.signin(user.id)
  assert.equal(first.reward, SIGNIN_REWARDS[0])
  assert.equal(first.user.coins, START_COINS + SIGNIN_REWARDS[0])
  assert.equal(first.status.streak, 1)
  await assert.rejects(async () => await accounts.signin(user.id), /已签到/)
  // 模拟"昨天签到过"
  await accounts.store.updateUser(user.id, { signin_day: (await accounts.store.getUser(user.id))!.signin_day - 1 })
  assert.equal((await accounts.signin(user.id)).reward, SIGNIN_REWARDS[1])
  // 断签后重新计数
  await accounts.store.updateUser(user.id, { signin_day: (await accounts.store.getUser(user.id))!.signin_day - 3 })
  assert.equal((await accounts.signin(user.id)).reward, SIGNIN_REWARDS[0])

  await assert.rejects(async () => await accounts.relief(user.id), /低于/)
  await accounts.store.updateUser(user.id, { coins: 10 })
  assert.equal((await accounts.relief(user.id)).user.coins, 10 + RELIEF_AMOUNT)
  await accounts.store.updateUser(user.id, { coins: 0 })
  await accounts.relief(user.id)
  await accounts.store.updateUser(user.id, { coins: 0 })
  await accounts.relief(user.id)
  await accounts.store.updateUser(user.id, { coins: 0 })
  await assert.rejects(async () => await accounts.relief(user.id), /已领完/)
  assert.ok((await accounts.store.listLedger(user.id)).length >= 6)
})

test('人机对战整局：自动推进 5 轮并正确结算金币', async () => {
  const { accounts, rooms, lastRoom, join } = setup()
  const userId = await join('player1')
  await rooms.quick(userId, 'qingyun', 'hard')
  const view = () => lastRoom.get(userId) as RoomView
  assert.equal(view().status, 'playing')
  assert.equal(view().game?.hand.length, 5)

  let played = 0
  while (view().status === 'playing') {
    const game = view().game!
    if (game.phase === 'selecting' && game.round < 5 && !game.picked) {
      await rooms.play(userId, game.round, [game.hand[0].id, game.hand[1].id])
      played += 1
    }
    await sleep(3)
  }
  assert.equal(played, 4)
  const final = view()
  assert.equal(final.status, 'finished')
  assert.equal(final.game?.results.length, 5)
  const mine = final.settlement!.find((entry) => entry.seat === final.mySeat)!
  const total = final.game!.seats[final.mySeat].total
  assert.equal(mine.total, total)
  assert.equal(mine.coinsDelta, total * HALLS[0].stake)
  assert.equal(final.settlement!.reduce((sum, entry) => sum + entry.total, 0), 0)
  const profile = await accounts.profile(userId)
  assert.equal(profile.coins, START_COINS + total * HALLS[0].stake)
  assert.equal(profile.games, 1)
  assert.equal((await accounts.store.listMatches(userId)).length, 1)
  assert.equal((await accounts.store.listMatches(userId))[0].rounds.length, 5)

  // 再来一局：机器人已准备，直接开新局
  await rooms.again(userId)
  assert.equal(view().status, 'playing')
  assert.equal(view().game?.round, 1)
  rooms.shutdown()
})

test('好友房：加入、补机器人、超时托管、离开转托管', async () => {
  const { accounts, rooms, lastRoom, join, online } = setup()
  const a = await join('host_a')
  const b = await join('guest_b')
  await rooms.create(a, 'qingyun', false)
  const roomId = lastRoom.get(a)!.id
  assert.equal(rooms.lobbyState().rooms.length, 1)
  await rooms.join(b, roomId)
  await assert.rejects(async () => await rooms.start(b), /房主/)
  await assert.rejects(async () => await rooms.start(a), /3 名玩家/)
  await rooms.addBot(a, 'normal')
  await rooms.start(a)
  assert.equal(lastRoom.get(b)!.status, 'playing')
  // 看不到别人的手牌，只能看到张数
  assert.equal(lastRoom.get(b)!.game!.seats[0].handCount, 5)

  // b 掉线，a 中途离开：两人都由 AI 托管，对局照常打完并结算
  online.delete(b)
  await rooms.onDisconnect(b)
  await rooms.leave(a)
  assert.equal(lastRoom.get(a), null)
  let done = false
  while (!done) {
    done = (await accounts.profile(a)).games === 1 && (await accounts.profile(b)).games === 1
    await sleep(5)
  }
  assert.equal((await accounts.profile(a)).coins + (await accounts.profile(b)).coins - 2 * START_COINS
    + (await accounts.store.listMatches(a))[0].players.find((p) => p.isBot)!.total * HALLS[0].stake, 0, '金币零和')
  // 无人在线的房间最终被回收
  await waitFor(() => rooms.roomCount === 0)
  rooms.shutdown()
})

test('金币不足无法入场', async () => {
  const { accounts, rooms, join } = setup()
  const userId = await join('poor_guy')
  await accounts.store.updateUser(userId, { coins: 100 })
  await assert.rejects(async () => await rooms.quick(userId, 'qingyun', 'easy'), /金币不足/)
  await assert.rejects(async () => await rooms.quick(userId, 'nope', 'easy'), /场次不存在/)
})

test('机器人各难度都能给出合法出牌', async () => {
  for (const level of ['easy', 'normal', 'hard', 'peek'] as const) {
    for (let i = 0; i < 20; i += 1) {
      const game = createGame(['a', 'b', 'c'])
      const hand = game.players[0].hand
      const ids = decidePick({
        level, round: 1 + (i % 4), hand, publicCard: i % 4 === 3 ? null : game.publicCards[0],
        seen: game.publicCards.slice(0, 3), peekHands: level === 'peek' ? [game.players[1].hand] : undefined,
      })
      assert.equal(new Set(ids).size, 2)
      assert.ok(ids.every((id) => hand.some((card) => card.id === id)))
    }
  }
})

test('防刷：同一 IP 建号有上限，游客不上榜', async () => {
  const { accounts } = setup()
  for (let i = 0; i < 6; i += 1) await accounts.guest({}, '9.9.9.9')
  await assert.rejects(async () => await accounts.guest({}, '9.9.9.9'), /上限/)
  await accounts.guest({}, '8.8.8.8')
  await accounts.guest({}, '127.0.0.1')
  const { user } = await accounts.guest()
  await accounts.store.updateUser(user.id, { games: 5, honor: 999 })
  assert.equal((await accounts.store.leaderboard('honor')).length, 0)
  assert.equal(await accounts.store.rankOf(user.id, 'honor'), 0)
})

test('恢复码找回密码', async () => {
  const { accounts } = setup()
  const { user, token, recoveryCode } = await accounts.register({ username: 'forgetful', password: 'secret123' })
  await assert.rejects(async () => await accounts.resetPassword({ username: 'forgetful', recoveryCode: 'AAAA-BBBB-CCCC', password: 'newpass99' }), /不正确/)
  const next = await accounts.resetPassword({ username: 'forgetful', recoveryCode: recoveryCode.toLowerCase(), password: 'newpass99' })
  assert.notEqual(next.recoveryCode, recoveryCode)
  assert.equal(await accounts.authenticate(token), undefined, '重置后旧会话失效')
  await assert.rejects(async () => await accounts.login({ username: 'forgetful', password: 'secret123' }))
  assert.equal((await accounts.login({ username: 'forgetful', password: 'newpass99' })).user.id, user.id)
  await assert.rejects(async () => await accounts.resetPassword({ username: 'forgetful', recoveryCode, password: 'again9999' }), /不正确/)
})

test('商城购买与装备', async () => {
  const { accounts } = setup()
  const { user } = await accounts.register({ username: 'shopper', password: 'secret123' })
  await assert.rejects(async () => await accounts.buyItem(user.id, 'frame-crown'), /金币不足/)
  await assert.rejects(async () => await accounts.equipItem(user.id, 'frame', 'frame-jade'), /尚未拥有/)
  const bought = await accounts.buyItem(user.id, 'frame-jade')
  assert.equal(bought.coins, START_COINS - 3000)
  assert.equal(bought.frame, 'frame-jade')
  await assert.rejects(async () => await accounts.buyItem(user.id, 'frame-jade'), /已拥有/)
  assert.equal((await accounts.equipItem(user.id, 'frame', '')).frame, '')
  await assert.rejects(async () => await accounts.equipItem(user.id, 'felt', 'frame-jade'), /尚未拥有/)
})

test('每日任务、成就与赛季', async () => {
  const { accounts } = setup()
  const { user } = await accounts.register({ username: 'grinder', password: 'secret123' })
  await assert.rejects(async () => await accounts.claimGrowth(user.id, 't_games3'), /尚未达成/)
  await accounts.signin(user.id)
  const before = (await accounts.profile(user.id)).coins
  assert.equal((await accounts.claimGrowth(user.id, 't_signin')).user.coins, before + 200)
  await assert.rejects(async () => await accounts.claimGrowth(user.id, 't_signin'), /已领取/)
  assert.equal((await accounts.claimGrowth(user.id, 'a_bind')).reward, 1000)
  const growth = await accounts.growth(user.id)
  assert.equal(growth.tasks.find((task) => task.id === 't_signin')!.claimed, true)
  assert.equal(growth.achievements.find((item) => item.id === 'a_first')!.done, false)
  // 换季：按爵位发奖，荣誉保留四成
  assert.equal(await accounts.touchSeason(user.id), null)
  await accounts.store.updateUser(user.id, { season: '2020-01', honor: 700 })
  const reward = await accounts.touchSeason(user.id)
  assert.equal(reward?.reward, 4000)
  assert.equal((await accounts.profile(user.id)).honor, 280)
  assert.equal(await accounts.touchSeason(user.id), null)
})

test('运营后台：口令认证、发币、封禁、重置密码', async () => {
  const accounts = new Accounts(new SqliteStore(':memory:'), 1000, 'top-secret-key')
  const admin = await accounts.register({ username: 'boss', password: 'secret123' })
  const player = await accounts.register({ username: 'player', password: 'secret123' })
  await assert.rejects(async () => await accounts.requireAdmin(admin.user.id), /权限/)
  await assert.rejects(async () => await accounts.claimAdmin(admin.user.id, 'wrong'), /口令/)
  assert.equal((await accounts.claimAdmin(admin.user.id, 'top-secret-key')).isAdmin, true)
  assert.equal((await accounts.adminGrant(admin.user.id, player.user.id, 5000, '活动')).coins, START_COINS + 5000)
  assert.equal((await accounts.adminBan(admin.user.id, player.user.id, true)).banned, 1)
  assert.equal(await accounts.authenticate(player.token), undefined)
  await assert.rejects(async () => await accounts.login({ username: 'player', password: 'secret123' }), /封禁/)
  await accounts.adminBan(admin.user.id, player.user.id, false)
  const { password } = await accounts.adminResetPassword(player.user.id)
  assert.equal((await accounts.login({ username: 'player', password })).user.id, player.user.id)
  assert.equal((await accounts.adminStats()).users, 2)
  assert.equal((await accounts.store.searchUsers('play')).length, 1)
})

test('快速匹配：超时由机器人补位；三名真人立即开局', async () => {
  const { rooms, lastRoom, join } = setup()
  const solo = await join('solo_one')
  await rooms.match(solo, 'qingyun')
  assert.equal(lastRoom.get(solo)!.matching, true)
  assert.equal(lastRoom.get(solo)!.status, 'waiting')
  await waitFor(() => lastRoom.get(solo)!.status === 'playing')
  assert.equal(lastRoom.get(solo)!.seats.filter((seat) => seat?.isBot).length, 2)
  await rooms.leave(solo)

  const [a, b, c] = [await join('trio_a'), await join('trio_b'), await join('trio_c')]
  await rooms.match(a, 'qingyun')
  await rooms.match(b, 'qingyun')
  assert.equal(lastRoom.get(a)!.status, 'waiting')
  await rooms.match(c, 'qingyun')
  assert.equal(lastRoom.get(a)!.status, 'playing')
  assert.equal(lastRoom.get(a)!.id, lastRoom.get(c)!.id)
  assert.equal(lastRoom.get(c)!.seats.every((seat) => seat && !seat.isBot), true)
  rooms.shutdown()
})

test('观战只能看到公开信息', async () => {
  const { rooms, lastRoom, join } = setup()
  const host = await join('host_w')
  const watcher = await join('watcher')
  await rooms.create(host, 'qingyun', false)
  const roomId = lastRoom.get(host)!.id
  await rooms.addBot(host, 'easy')
  await rooms.addBot(host, 'easy')
  await rooms.start(host)
  await rooms.spectate(watcher, roomId)
  const view = lastRoom.get(watcher)!
  assert.equal(view.mySeat, -1)
  assert.equal(view.game!.hand.length, 0)
  assert.equal(view.spectators, 1)
  await assert.rejects(async () => await rooms.play(watcher, 1, ['S1', 'S2']), /没有进行中/)
  await rooms.leave(watcher)
  assert.equal(lastRoom.get(watcher), null)
  rooms.shutdown()
})

test('对局存档：服务重启后恢复并打完结算', async () => {
  const store = new SqliteStore(':memory:')
  const online = new Set<string>()
  const hub = { send() {}, isOnline: (id: string) => online.has(id), onlineUserIds: () => [...online] }
  const accounts = new Accounts(store, 1000)
  const { user } = await accounts.register({ username: 'survivor', password: 'secret123' })
  online.add(user.id)
  const first = new RoomManager(accounts, hub, { ...FAST, pickMs: 60000, botMinMs: 60000, botMaxMs: 60001 })
  await first.quick(user.id, 'qingyun', 'normal')
  await sleep(10)
  assert.equal((await store.listRooms()).length, 1)
  first.shutdown() // 模拟进程被回收

  online.clear()
  const second = new RoomManager(accounts, hub, FAST)
  assert.equal(await second.restore(), 1)
  let done = false
  while (!done) {
    done = (await accounts.profile(user.id)).games === 1
    await sleep(5)
  }
  await sleep(20)
  assert.equal((await store.listRooms()).length, 0, '打完后存档被清除')
  second.shutdown()
})

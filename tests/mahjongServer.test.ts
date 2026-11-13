import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { HALLS, START_COINS } from '../src/shared/economy.ts'
import { DEFAULT_OPTIONS, applyAction, dealGame } from '../src/shared/mahjong/game.ts'
import type { MjLevel, MjView } from '../src/shared/mahjong/view.ts'
import type { ServerEvent } from '../src/shared/protocol.ts'
import { Accounts } from '../src/server/accounts.ts'
import { decryptSecret, encryptSecret, maskKey } from '../src/server/ai.ts'
import { MahjongManager, MjTimings } from '../src/server/mahjong.ts'
import { botAction } from '../src/server/mjBot.ts'
import { SqliteStore } from '../src/server/sqliteStore.ts'

const FAST: MjTimings = { diceMs: 5, diceExtraMs: 1, botMinMs: 1, botMaxMs: 2, claimMs: 1, turnMs: 400, claimTurnMs: 400, offlineMs: 5, matchMs: 40, idleMs: 60000 }

function mulberry(seed: number) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function setup(dataKey = 'unit-test-data-key') {
  const accounts = new Accounts(new SqliteStore(':memory:'), 1000, '', dataKey)
  let last: MjView | null = null
  const views: MjView[] = []
  const hub = {
    send(_userId: string, event: ServerEvent) {
      if (event.ev === 'mj') {
        last = event.table
        if (event.table) views.push(event.table)
      }
    },
    isOnline: () => true,
  }
  const mahjong = new MahjongManager(accounts, hub, FAST)
  const { user } = await accounts.register({ username: 'mj_player', password: 'secret123' })
  return { accounts, mahjong, userId: user.id, view: () => last as MjView | null, views }
}

/** 真人座位的自动打法：能胡就胡，能杠就杠，否则打刚摸的牌 */
async function autoplay(mahjong: MahjongManager, userId: string, view: () => MjView | null) {
  for (let guard = 0; guard < 4000; guard += 1) {
    const table = view()
    if (!table) return
    if (table.phase === 'over') return
    const actor = table.phase === 'claim' ? table.claimSeat : table.turn
    if (table.phase !== 'dice' && actor === 0) {
      const c = table.choices
      if (table.phase === 'claim') await mahjong.act(userId, c.kong ? { type: 'kong' } : { type: 'pass' })
      else if (c.hu) await mahjong.act(userId, { type: 'hu' })
      else if (c.ankan.length) await mahjong.act(userId, { type: 'ankan', kind: c.ankan[0] })
      else await mahjong.act(userId, { type: 'discard', tile: table.drawn ?? c.discards[0] })
    } else {
      await sleep(2)
    }
  }
  throw new Error('对局没有结束')
}

test('人机试炼：掷骰定庄 → 整局 → 金币结算 → 下一局换庄', async () => {
  const { accounts, mahjong, userId, view, views } = await setup()
  await mahjong.start(userId, 'qingyun', 'hard', DEFAULT_OPTIONS)
  const first = view()!
  assert.equal(first.phase, 'dice')
  assert.ok(first.dice && first.dice[0].rolls.length === 4, '四人各掷一次')
  assert.equal(first.seats.length, 4)
  await assert.rejects(async () => await mahjong.act(userId, { type: 'hu' }), /没有进行中/)

  let coins = START_COINS
  for (let hand = 1; hand <= 3; hand += 1) {
    await autoplay(mahjong, userId, view)
    const over = view()!
    assert.equal(over.phase, 'over')
    assert.equal(over.handNo, hand)
    assert.equal(over.seats.reduce((sum, seat) => sum + seat.score, 0), 0, '分数零和')
    assert.ok(over.seats.every((seat) => seat.hand !== null), '结束后亮牌')
    assert.ok(over.record && over.record.events.length > 4, '附带牌谱')
    assert.ok(over.settlement, '已结算')
    assert.equal(over.settlement!.coinsDelta, over.seats[0].score * HALLS[0].stake)
    coins += over.settlement!.coinsDelta
    assert.equal((await accounts.profile(userId)).coins, coins)
    const detail = await accounts.store.getMatchDetail(over.settlement!.matchId, userId)
    assert.equal(detail?.game, 'mahjong')
    assert.equal(await accounts.store.getMatchDetail(over.settlement!.matchId, 'someone-else'), undefined)
    const nextDealer = over.result!.nextDealer
    assert.equal(nextDealer, over.result!.winner >= 0 ? over.result!.winner : over.dealer, '赢家坐庄，流局连庄')
    await mahjong.next(userId)
    assert.equal(view()!.dealer, nextDealer)
    assert.equal(view()!.dice, null, '只有首局掷骰')
  }
  assert.equal((await accounts.profile(userId)).games, 3)
  // 对局中：看不到别人的手牌，也看不到别人摸了什么
  for (const table of views) {
    if (table.phase === 'over') continue
    assert.ok(table.seats.slice(1).every((seat) => seat.hand === null))
    if (table.lastEvent?.t === 'draw' && table.lastEvent.seat !== 0) assert.equal(table.lastEvent.tile, -1)
    assert.equal(table.record, null)
  }
  await mahjong.leave(userId)
  assert.equal(view(), null)
  assert.equal(mahjong.tableCount, 0)
  mahjong.shutdown()
})

test('金币不足不能开局；难度与场次校验', async () => {
  const { accounts, mahjong, userId } = await setup()
  await assert.rejects(async () => await mahjong.start(userId, 'nope', 'easy', DEFAULT_OPTIONS), /场次不存在/)
  await assert.rejects(async () => await mahjong.start(userId, 'qingyun', 'god' as MjLevel, DEFAULT_OPTIONS), /难度无效/)
  await accounts.store.updateUser(userId, { coins: 10 })
  await assert.rejects(async () => await mahjong.start(userId, 'qingyun', 'easy', DEFAULT_OPTIONS), /金币不足/)
})

test('四档机器人都能把牌打完，且难度越高胡得越多', () => {
  const random = mulberry(2026)
  const wins: Record<MjLevel, number> = { easy: 0, normal: 0, hard: 0, master: 0 }
  const levels: MjLevel[] = ['easy', 'normal', 'hard', 'master']
  const GAMES = 240
  for (let n = 0; n < GAMES; n += 1) {
    // 四档各坐一家，座位轮换，消除庄家优势
    const seating = levels.map((_, index) => levels[(index + n) % 4])
    const game = dealGame(n % 4, DEFAULT_OPTIONS, random)
    let steps = 0
    while (game.phase !== 'over') {
      steps += 1
      assert.ok(steps < 700)
      const seat = game.phase === 'claim' ? game.claim!.seat : game.turn
      applyAction(game, seat, botAction(game, seat, seating[seat], random))
    }
    if (game.result!.winner >= 0) wins[seating[game.result!.winner]] += 1
  }
  assert.ok(wins.easy + wins.normal + wins.hard + wins.master > GAMES * 0.7, JSON.stringify(wins))
  assert.ok(wins.hard > wins.easy * 1.5, `高手应明显强于入门 ${JSON.stringify(wins)}`)
  assert.ok(wins.master > wins.easy * 1.5, `大师应明显强于入门 ${JSON.stringify(wins)}`)
  assert.ok(wins.normal > wins.easy, `进阶应强于入门 ${JSON.stringify(wins)}`)
  console.log('  各难度胡牌数', wins)
})

test('AI 设置：API Key 加密保存，只回显掩码', async () => {
  const { accounts, userId } = await setup()
  const cipher = await encryptSecret('sk-abcdef1234567890', 'k1')
  assert.ok(!cipher.includes('abcdef'))
  assert.equal(await decryptSecret(cipher, 'k1'), 'sk-abcdef1234567890')
  await assert.rejects(async () => await decryptSecret(cipher, 'other-key'), /无法解密/)
  assert.equal(maskKey('sk-abcdef1234567890'), 'sk-ab****7890')

  await assert.rejects(async () => await accounts.aiReview(userId, 'no-match', 'x'.repeat(50)), /没有找到/)
  await assert.rejects(async () => await accounts.testAi(userId), /还没有设置/)
  await assert.rejects(async () => await accounts.saveAiSettings(userId, { apiKey: 'short' }), /格式/)
  const saved = await accounts.saveAiSettings(userId, { apiKey: 'sk-abcdef1234567890', model: 'deepseek-reasoner' })
  assert.equal(saved.aiKeyMask, 'sk-ab****7890')
  assert.equal(saved.aiModel, 'deepseek-reasoner')
  const row = (await accounts.store.getUser(userId))!
  assert.ok(row.ai_key && !row.ai_key.includes('abcdef'), '数据库里不是明文')
  assert.ok(!JSON.stringify(saved).includes('abcdef1234'), '接口不返回明文')
  assert.equal((await accounts.saveAiSettings(userId, { apiKey: '' })).aiKeyMask, '')

  // 服务器没配加密密钥时拒绝保存
  const noKey = await setup('')
  await assert.rejects(async () => await noKey.accounts.saveAiSettings(noKey.userId, { apiKey: 'sk-abcdef1234567890' }), /加密密钥/)
})

// ------------------------------ 真人联机 ------------------------------

import { reviewRecord } from '../src/client/mahjong/review.ts'
import { kindOf as tileKind } from '../src/shared/mahjong/tiles.ts'

async function multi(count: number, timings: Partial<MjTimings> = {}) {
  const accounts = new Accounts(new SqliteStore(':memory:'), 1000, '', 'k')
  const views = new Map<string, MjView | null>()
  const online = new Set<string>()
  const hub = {
    send(userId: string, event: ServerEvent) { if (event.ev === 'mj') views.set(userId, event.table) },
    isOnline: (userId: string) => online.has(userId),
  }
  const mahjong = new MahjongManager(accounts, hub, { ...FAST, ...timings })
  const users: string[] = []
  for (let i = 0; i < count; i += 1) {
    const { user } = await accounts.register({ username: `mj_user_${i}`, password: 'secret123' })
    users.push(user.id)
    online.add(user.id)
  }
  const view = (userId: string) => views.get(userId) as MjView
  return { accounts, mahjong, users, view, online }
}

/** 让指定的真人都自动出牌，直到这一局结束 */
async function playOut(mahjong: MahjongManager, players: string[], view: (id: string) => MjView) {
  for (let guard = 0; guard < 6000; guard += 1) {
    if (players.every((id) => !view(id) || view(id).phase === 'over')) return
    let moved = false
    for (const id of players) {
      const table = view(id)
      if (!table || table.phase === 'dice' || table.phase === 'waiting' || table.phase === 'over') continue
      const actor = table.phase === 'claim' ? table.claimSeat : table.turn
      if (actor !== 0) continue
      const c = table.choices
      const action = table.phase === 'claim' ? (c.kong ? { type: 'kong' as const } : { type: 'pass' as const })
        : c.hu ? { type: 'hu' as const } : { type: 'discard' as const, tile: table.drawn ?? c.discards[0] }
      await mahjong.act(id, action).catch(() => {})
      moved = true
    }
    if (!moved) await sleep(2)
  }
  throw new Error('对局没有结束')
}

test('快速匹配：四名真人凑齐立即开局，各自视角正确，整局零和并分别结算', async () => {
  const { accounts, mahjong, users, view } = await multi(4)
  for (const id of users.slice(0, 3)) await mahjong.match(id, 'qingyun')
  assert.equal(view(users[0]).phase, 'waiting')
  assert.equal(view(users[0]).matching, true)
  assert.equal(view(users[2]).seats.filter((seat) => !seat.empty).length, 3)
  await mahjong.match(users[3], 'qingyun')
  assert.equal(view(users[0]).phase, 'dice')
  assert.equal(new Set(users.map((id) => view(id).roomId)).size, 1, '四人在同一桌')
  assert.equal(mahjong.lobbyRooms().length, 0, '匹配桌不出现在大厅列表')

  await sleep(40)
  // 每个人都看到自己在 0 号位、拿着自己的 13 或 14 张牌，且四人手牌互不重复
  const hands = users.map((id) => view(id).hand)
  assert.ok(hands.every((hand) => hand.length === 13 || hand.length === 14))
  assert.equal(new Set(hands.flat()).size, hands.flat().length)
  users.forEach((id) => {
    const table = view(id)
    assert.equal(table.seats[0].userId, id)
    assert.ok(table.seats.slice(1).every((seat) => seat.hand === null && seat.userId !== id))
  })
  // 同一时刻只有一个人看到"轮到我"，并且大家对庄家是谁的看法一致
  assert.equal(users.filter((id) => view(id).turn === 0).length, 1)
  const dealerNames = users.map((id) => view(id).seats[view(id).dealer].name)
  assert.equal(new Set(dealerNames).size, 1)

  await playOut(mahjong, users, view)
  const scores = users.map((id) => view(id).seats[0].score)
  assert.equal(scores.reduce((sum, value) => sum + value, 0), 0, `四人分数零和 ${scores.join(' / ')}`)
  for (const id of users) {
    const table = view(id)
    assert.equal(table.settlement!.coinsDelta, table.seats[0].score * HALLS[0].stake)
    assert.equal((await accounts.profile(id)).coins, START_COINS + table.settlement!.coinsDelta)
    // 各自拿到的牌谱都以自己为 0 号位，可以重放并复盘
    const review = reviewRecord(table.record!)
    assert.ok(review.discards.every((item) => item.hand.every((tile) => tileKind(tile) >= 0)))
    assert.equal(table.record!.names[0], table.seats[0].name)
  }
  const winners = users.map((id) => view(id).result!.winner >= 0 ? view(id).seats[view(id).result!.winner].name : '流局')
  assert.equal(new Set(winners).size, 1, '大家看到的赢家是同一个人')

  // 下一局：要四个人都点了才发牌
  await mahjong.next(users[0])
  assert.equal(view(users[0]).phase, 'over')
  assert.equal(view(users[1]).seats.find((seat) => seat.userId === users[0])!.ready, true)
  for (const id of users.slice(1)) await mahjong.next(id)
  assert.equal(view(users[0]).handNo, 2)
  assert.notEqual(view(users[0]).phase, 'over')
  mahjong.shutdown()
})

test('好友约局：房号加入、房主开始时机器人补位、大厅可见', async () => {
  const { mahjong, users, view } = await multi(3)
  await mahjong.create(users[0], 'qingyun', false, 'hard', DEFAULT_OPTIONS)
  const roomId = view(users[0]).roomId
  assert.match(roomId, /^9\d{5}$/)
  assert.equal(mahjong.lobbyRooms().length, 1)
  assert.equal(mahjong.lobbyRooms()[0].game, 'mahjong')
  await mahjong.join(users[1], roomId)
  assert.equal(view(users[0]).seats.filter((seat) => !seat.empty).length, 2)
  assert.equal(view(users[1]).hostSeat !== 0, true)
  await assert.rejects(async () => await mahjong.beginByHost(users[1]), /房主/)
  await assert.rejects(async () => await mahjong.join(users[2], '900000'), /不存在/)
  await mahjong.beginByHost(users[0])
  assert.equal(view(users[1]).phase, 'dice')
  assert.equal(view(users[1]).seats.filter((seat) => seat.isBot).length, 2, '空位由机器人补齐')
  await assert.rejects(async () => await mahjong.join(users[2], roomId), /已经开打/)
  assert.deepEqual(mahjong.publicRoomOf(users[1]), { id: roomId, status: 'playing', joinable: false, game: 'mahjong' })
  mahjong.shutdown()
})

test('超时自动出牌、掉线托管、中途离开照常结算', async () => {
  const { accounts, mahjong, users, view, online } = await multi(2, { turnMs: 30, claimTurnMs: 30 })
  await mahjong.create(users[0], 'qingyun', true, 'normal', DEFAULT_OPTIONS)
  await mahjong.join(users[1], view(users[0]).roomId)
  await mahjong.beginByHost(users[0])
  await sleep(30)
  assert.ok(view(users[0]).deadlineAt === null || view(users[0]).deadlineAt! > 0)
  // 两个人都不操作：靠超时也能把牌打下去
  const before = view(users[0]).wallCount
  await sleep(400)
  assert.ok(view(users[0]).wallCount < before || view(users[0]).phase === 'over', '超时后自动出牌，牌局在推进')

  // 1 号掉线：座位显示托管，由机器人代打
  online.delete(users[1])
  mahjong.onDisconnect(users[1])
  await sleep(20)
  if (view(users[0]).phase !== 'over') {
    const seat = view(users[0]).seats.find((item) => item.userId === users[1])!
    assert.equal(seat.trustee, true)
  }
  // 0 号中途离开：桌上没有在线真人也要把这局打完并结算
  await mahjong.leave(users[0])
  assert.equal(view(users[0]), null)
  await sleep(50)
  online.add(users[1])
  mahjong.onConnect(users[1])
  for (let guard = 0; guard < 3000 && view(users[1]) && view(users[1]).phase !== 'over'; guard += 1) await sleep(5)
  const final = view(users[1])
  assert.ok(final, '1 号重连后还在桌上')
  assert.equal(final.phase, 'over')
  assert.equal((await accounts.profile(users[0])).games, 1, '离开的人这一局照常结算')
  assert.equal((await accounts.profile(users[1])).games, 1)
  const a = (await accounts.profile(users[0])).coins - START_COINS
  const b = (await accounts.profile(users[1])).coins - START_COINS
  assert.equal(b, final.seats[0].score * HALLS[0].stake)
  assert.equal(final.seats.reduce((sum, seat) => sum + seat.score, 0), 0, '四家分数零和')
  // 离开的人按他那个座位的分数结算
  assert.ok(final.seats.some((seat) => seat.score * HALLS[0].stake === a))
  assert.ok(final.seats.every((seat) => seat.userId !== users[0]), '离开的人的座位结算后交给机器人')
  mahjong.shutdown()
})

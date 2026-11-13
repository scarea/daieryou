import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { HALLS, START_COINS } from '../src/shared/economy.ts'
import { LH_RULES, } from '../src/shared/liuhu/hand.ts'
import { actorOf, applyLiuhu, dealLiuhu } from '../src/shared/liuhu/game.ts'
import { LH_LEVELS, LhView } from '../src/shared/liuhu/view.ts'
import type { ServerEvent } from '../src/shared/protocol.ts'
import { Accounts } from '../src/server/accounts.ts'
import { LhTimings, LiuhuManager } from '../src/server/liuhu.ts'
import { lhBotAction } from '../src/server/lhBot.ts'
import { SqliteStore } from '../src/server/sqliteStore.ts'

const FAST: LhTimings = { flipMs: 5, flipExtraMs: 1, botMinMs: 1, botMaxMs: 2, claimMs: 1, turnMs: 300, claimTurnMs: 300, offlineMs: 5, matchMs: 40, idleMs: 60000 }

function mulberry(seed: number) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function setup(names = ['lh_one']) {
  const accounts = new Accounts(new SqliteStore(':memory:'), 1000, '', 'k')
  const last = new Map<string, LhView | null>()
  const views: LhView[] = []
  const hub = {
    send(userId: string, event: ServerEvent) {
      if (event.ev !== 'lh') return
      last.set(userId, event.table)
      if (event.table) views.push(event.table)
    },
    isOnline: () => true,
  }
  const liuhu = new LiuhuManager(accounts, hub, FAST)
  const ids: string[] = []
  for (const username of names) ids.push((await accounts.register({ username, password: 'secret123' })).user.id)
  return { accounts, liuhu, ids, view: (userId: string) => last.get(userId) ?? null, views }
}

/** 真人座位：能胡就胡，吃碰都放过，打第一张能打的牌 */
async function autoplay(liuhu: LiuhuManager, users: string[], view: (userId: string) => LhView | null) {
  for (let guard = 0; guard < 6000; guard += 1) {
    const tables = users.map((userId) => view(userId))
    if (tables.every((table) => !table || table.phase === 'over')) return
    let acted = false
    for (const [index, table] of tables.entries()) {
      if (!table || table.actor !== 0 || (table.phase !== 'discard' && table.phase !== 'claim')) continue
      const c = table.choices
      await liuhu.act(users[index], c.hu ? { type: 'hu' } : c.discards.length ? { type: 'discard', tile: c.discards[0] } : { type: 'pass' }).catch(() => {})
      acted = true
    }
    if (!acted) await sleep(2)
  }
  throw new Error('对局没有结束')
}

test('六胡抢人机试炼：翻牌定庄 → 整局 → 结算 → 下一局', async () => {
  const { accounts, liuhu, ids, view, views } = await setup()
  const userId = ids[0]
  await assert.rejects(async () => await liuhu.start(userId, 'qingyun', 'nope' as never), /难度/)
  await liuhu.start(userId, 'qingyun', 'hard')
  const first = view(userId)!
  assert.equal(first.phase, 'flip')
  assert.equal(first.flip![0].tiles.length, 4)
  let coins = START_COINS
  for (let hand = 1; hand <= 4; hand += 1) {
    await autoplay(liuhu, [userId], view)
    const over = view(userId)!
    assert.equal(over.phase, 'over')
    assert.equal(over.handNo, hand)
    assert.equal(over.seats.reduce((sum, seat) => sum + seat.score, 0), 0)
    assert.ok(over.seats.every((seat) => seat.hand !== null))
    assert.ok(over.settlement)
    assert.equal(over.settlement!.coinsDelta, Math.max(-coins, over.seats[0].score * HALLS[0].stake))
    coins += over.settlement!.coinsDelta
    assert.equal((await accounts.profile(userId)).coins, coins)
    const detail = await accounts.store.getMatchDetail(over.settlement!.matchId, userId)
    assert.equal(detail?.game, 'liuhu')
    const nextDealer = over.result!.nextDealer
    assert.equal(nextDealer, over.result!.winner >= 0 ? over.result!.winner : over.dealer)
    if (coins < HALLS[0].minCoins) break
    await liuhu.next(userId)
    assert.equal(view(userId)!.dealer, nextDealer)
    assert.equal(view(userId)!.flip, null)
  }
  // 对局中看不到别人的手牌，也看不到别人扣着的提
  for (const table of views) {
    if (table.phase === 'over') continue
    assert.ok(table.seats.slice(1).every((seat) => seat.hand === null))
    for (const seat of table.seats.slice(1)) for (const meld of seat.melds) if (meld.type === 'ti') assert.ok(meld.tiles.every((tile) => tile === -1))
  }
  await liuhu.leave(userId)
  assert.equal(view(userId), null)
  assert.equal(liuhu.tableCount, 0)
  liuhu.shutdown()
})

test('六胡抢好友约局：建桌、入座、房主开始、各自视角', async () => {
  const { liuhu, ids, view } = await setup(['lh_a', 'lh_b', 'lh_c'])
  await liuhu.create(ids[0], 'qingyun', false, 'normal')
  const roomId = view(ids[0])!.roomId
  assert.match(roomId, /^9\d{5}$/)
  assert.equal(liuhu.lobbyRooms()[0].game, 'liuhu')
  await liuhu.join(ids[1], roomId)
  await liuhu.join(ids[2], roomId)
  await assert.rejects(async () => await liuhu.beginByHost(ids[1]), /房主/)
  await liuhu.beginByHost(ids[0])
  await autoplay(liuhu, ids, view)
  const tables = ids.map((userId) => view(userId)!)
  assert.ok(tables.every((table) => table.phase === 'over'))
  // 每个人都把自己看成 0 号位：同一个赢家换算回来是同一个人
  const names = tables.map((table) => (table.result!.winner >= 0 ? table.seats[table.result!.winner].name : ''))
  assert.equal(new Set(names).size, 1)
  assert.deepEqual(tables.map((table) => table.seats[0].name), ['lh_a', 'lh_b', 'lh_c'].map((name) => tables.find((table) => table.seats[0].name === name)!.seats[0].name))
  // 中途离开：桌子还在，座位交给机器人
  await liuhu.leave(ids[2])
  assert.equal(liuhu.tableCount, 1)
  await liuhu.leave(ids[0])
  await liuhu.leave(ids[1])
  assert.equal(liuhu.tableCount, 0)
  liuhu.shutdown()
})

test('六胡抢机器人：四档都能把牌打完，高手以上胜率不输入门', () => {
  const wins = [0, 0, 0, 0]
  let drawn = 0
  for (let seed = 1; seed <= 160; seed += 1) {
    const random = mulberry(seed * 7)
    const state = dealLiuhu(seed % 4, LH_RULES, random)
    // 0、2 号位大师，1、3 号位入门
    const levels = [LH_LEVELS[3], LH_LEVELS[0], LH_LEVELS[3], LH_LEVELS[0]]
    for (let guard = 0; state.phase !== 'over'; guard += 1) {
      assert.ok(guard < 3000)
      const seat = actorOf(state)
      applyLiuhu(state, seat, lhBotAction(state, seat, levels[seat], random))
    }
    if (state.result!.winner >= 0) wins[state.result!.winner] += 1
    else drawn += 1
  }
  const master = wins[0] + wins[2]
  const easy = wins[1] + wins[3]
  assert.ok(master + easy > 60, `大多数牌局应该有人胡：${master + easy}，荒庄 ${drawn}`)
  assert.ok(master > easy, `大师 ${master} 应多于入门 ${easy}`)
})

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

const FAST: MjTimings = { diceMs: 5, diceExtraMs: 1, botMinMs: 1, botMaxMs: 2, claimMs: 1, idleMs: 60000 }

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

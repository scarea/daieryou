import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeDiscards, canWin, isShaGui, shanten, waits } from '../src/shared/mahjong/hand.ts'
import { DEFAULT_OPTIONS, MjState, applyAction, choicesFor, dealGame, remainingFor, replay, rollForDealer, startFrom } from '../src/shared/mahjong/game.ts'
import { KIND_COUNT, ZHONG, allTiles, birdScore, countKinds, kindOf } from '../src/shared/mahjong/tiles.ts'

const OPT = { sevenPairs: true, fourZhong: true }
const NO7 = { sevenPairs: false, fourZhong: false }

/** '123m 456s 99p 中中' → 各牌种张数 */
function parse(text: string): number[] {
  const counts = new Array<number>(KIND_COUNT).fill(0)
  for (const part of text.split(/\s+/).filter(Boolean)) {
    if (part.startsWith('中')) { counts[ZHONG] += part.length; continue }
    const suit = 'msp'.indexOf(part.slice(-1))
    for (const ch of part.slice(0, -1)) counts[suit * 9 + Number(ch) - 1] += 1
  }
  return counts
}

function mulberry(seed: number) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- 独立的暴力解法：把红中逐张替换成任意牌，再做无癞子的标准判定 ----------
function plainWin(counts: number[], needPair: boolean): boolean {
  let first = -1
  for (let i = 0; i < 27; i += 1) if (counts[i] > 0) { first = i; break }
  if (first === -1) return !needPair
  if (needPair && counts[first] >= 2) {
    counts[first] -= 2
    const ok = plainWin(counts, false)
    counts[first] += 2
    if (ok) return true
  }
  if (counts[first] >= 3) {
    counts[first] -= 3
    const ok = plainWin(counts, needPair)
    counts[first] += 3
    if (ok) return true
  }
  if (first % 9 <= 6 && counts[first + 1] > 0 && counts[first + 2] > 0) {
    counts[first] -= 1; counts[first + 1] -= 1; counts[first + 2] -= 1
    const ok = plainWin(counts, needPair)
    counts[first] += 1; counts[first + 1] += 1; counts[first + 2] += 1
    if (ok) return true
  }
  return false
}
function bruteWin(counts: number[], sevenPairs: boolean, melds: number): boolean {
  const jokers = counts[ZHONG]
  const base = counts.slice(0, 27)
  const tryFill = (left: number, from: number): boolean => {
    if (left === 0) {
      if (plainWin(base, true)) return true
      return sevenPairs && melds === 0 && base.every((n) => n % 2 === 0)
    }
    for (let kind = from; kind < 27; kind += 1) {
      base[kind] += 1
      const ok = tryFill(left - 1, kind)
      base[kind] -= 1
      if (ok) return true
    }
    return false
  }
  return tryFill(jokers, 0)
}

test('胡牌牌型', () => {
  assert.ok(canWin(parse('123m 456m 789s 111p 55p'), 0, NO7))
  assert.ok(canWin(parse('111m 222m 333s 444p 99p'), 0, NO7), '对对胡')
  assert.ok(!canWin(parse('123m 456m 789s 112p 55p'), 0, NO7))
  assert.ok(canWin(parse('123m 456m 789s 11p 55p 中'), 0, NO7), '红中补刻子')
  assert.ok(canWin(parse('123m 456m 789s 111p 5p 中'), 0, NO7), '红中补将')
  assert.ok(canWin(parse('13m 456m 789s 111p 55p 中'), 0, NO7), '红中补嵌张')
  assert.ok(canWin(parse('12m 456m 789s 111p 55p 中'), 0, NO7), '红中补边张')
  assert.ok(canWin(parse('1m 456m 789s 111p 55p 中中'), 0, NO7), '两张红中补一组')
  assert.ok(canWin(parse('123m 456m 789s 111p 中中'), 0, NO7), '两张红中做将')
  assert.ok(canWin(parse('123m 55p'), 3, NO7), '碰杠三组后')
  assert.ok(canWin(parse('5p 中'), 4, NO7))
  assert.ok(!canWin(parse('5p 6p'), 4, NO7))
  assert.ok(!canWin(parse('123m 456m 789s 111p 5p'), 0, NO7), '张数不对')
})

test('七对与四红中', () => {
  const seven = parse('11m 33m 55s 77s 99p 22p 44p')
  assert.ok(canWin(seven, 0, OPT))
  assert.ok(!canWin(seven, 0, NO7))
  assert.ok(canWin(parse('11m 33m 55s 77s 99p 22p 4p 中'), 0, OPT), '红中凑对')
  assert.ok(canWin(parse('1111m 55s 77s 99p 22p 44p'), 0, OPT), '四张算两对')
  const four = parse('1m 4m 7m 2s 5s 8s 3p 6p 9p 1p 中中中中')
  assert.ok(canWin(four, 0, OPT), '四红中直接胡')
  assert.ok(!canWin(four, 0, NO7))
  assert.ok(isShaGui(parse('123m 456m 789s 111p 55p')))
  assert.ok(!isShaGui(parse('123m 456m 789s 11p 5p 中')))
})

test('胡牌判定与暴力解法一致（随机 4000 手）', () => {
  const random = mulberry(20261113)
  let wins = 0
  for (let i = 0; i < 4000; i += 1) {
    // 构造容易成牌的手：从较小的牌种范围里抽，并限制红中张数
    const pool = allTiles().filter((id) => (i % 3 === 0 ? kindOf(id) < 9 || kindOf(id) === ZHONG : i % 3 === 1 ? kindOf(id) < 18 || kindOf(id) === ZHONG : true))
    for (let j = pool.length - 1; j > 0; j -= 1) { const k = Math.floor(random() * (j + 1)); [pool[j], pool[k]] = [pool[k], pool[j]] }
    const melds = i % 5 === 0 ? 1 + (i % 3) : 0
    const hand = pool.slice(0, 14 - melds * 3)
    const counts = countKinds(hand)
    if (counts[ZHONG] > 2) continue
    const sevenPairs = i % 2 === 0
    const expected = bruteWin(counts, sevenPairs, melds)
    assert.equal(canWin(counts, melds, { sevenPairs, fourZhong: false }), expected, hand.map(kindOf).join(','))
    if (expected) wins += 1
  }
  assert.ok(wins > 50, `样本里应有足够多的胡牌（${wins}）`)
})

test('向听数与听牌', () => {
  assert.equal(shanten(parse('123m 456m 789s 111p 55p'), 0, OPT), -1)
  assert.equal(shanten(parse('123m 456m 789s 111p 5p'), 0, OPT), 0)
  assert.equal(shanten(parse('123m 456m 789s 11p 56p'), 0, OPT), 0)
  assert.equal(shanten(parse('123m 456m 789s 11p 5p 9p'), 0, OPT), 1)
  assert.equal(shanten(parse('123m 456m 78s 1p 5p 9p 3s 3p'), 0, NO7), 2)
  assert.deepEqual(waits(parse('123m 456m 789s 11p 55p'), 0, new Array(28).fill(4), NO7).map((w) => w.kind).sort((a, b) => a - b), [18, 22, ZHONG], '双碰 + 红中')
  assert.deepEqual(waits(parse('123m 456m 789s 111p 4p'), 0, new Array(28).fill(4), NO7).map((w) => w.kind), [21, ZHONG], '单吊 4 筒')
  assert.deepEqual(waits(parse('123m 456m 789s 23p 55p'), 0, new Array(28).fill(4), NO7).map((w) => w.kind), [18, 21, ZHONG], '两面听 1、4 筒')
})

test('向听数边界与精确判定一致（随机 3000 手）', () => {
  const random = mulberry(7)
  const full = new Array(28).fill(4)
  for (let i = 0; i < 3000; i += 1) {
    const pool = allTiles().filter((id) => (i % 2 === 0 ? kindOf(id) < 18 || kindOf(id) === ZHONG : true))
    for (let j = pool.length - 1; j > 0; j -= 1) { const k = Math.floor(random() * (j + 1)); [pool[j], pool[k]] = [pool[k], pool[j]] }
    const counts14 = countKinds(pool.slice(0, 14))
    const options = { sevenPairs: i % 2 === 0, fourZhong: false }
    assert.equal(shanten(counts14, 0, options) === -1, canWin(counts14, 0, options))
    const counts13 = countKinds(pool.slice(0, 13))
    const s13 = shanten(counts13, 0, options)
    assert.equal(s13 === 0, waits(counts13, 0, full, options).length > 0)
    // 摸一张牌，向听数最多前进一步，也不会后退
    counts13[kindOf(pool[20])] += 1
    const s14 = shanten(counts13, 0, options)
    assert.ok(s14 === s13 || s14 === s13 - 1, `${s13} → ${s14}`)
    // 打法分析：最优打法的向听数等于 14 张时的向听数（已胡除外）
    const best = analyzeDiscards(counts13, 0, full, options)[0]
    if (s14 >= 0) assert.equal(best.shanten, s14)
  }
})

test('抓鸟分值：一点、九点、红中 10 分，其余点数 + 1', () => {
  assert.equal(birdScore(0), 10)
  assert.equal(birdScore(8), 10)
  assert.equal(birdScore(9), 10)
  assert.equal(birdScore(26), 10)
  assert.equal(birdScore(ZHONG), 10)
  assert.equal(birdScore(1), 3)
  assert.equal(birdScore(13), 6)
  assert.equal(birdScore(25), 9)
})

test('掷骰定庄：点数最大者坐庄，并列重掷', () => {
  const random = mulberry(3)
  for (let i = 0; i < 200; i += 1) {
    const { rounds, dealer } = rollForDealer(random)
    const last = rounds[rounds.length - 1]
    const sums = last.rolls.map(([a, b]) => a + b)
    const best = Math.max(...sums)
    assert.equal(sums.filter((sum) => sum === best).length, 1)
    assert.equal(last.seats[sums.indexOf(best)], dealer)
    assert.equal(rounds[0].seats.length, 4)
    rounds.forEach((round) => round.rolls.forEach(([a, b]) => assert.ok(a >= 1 && a <= 6 && b >= 1 && b <= 6)))
  }
})

/** 按牌种构造一副牌墙：指定四家的手牌和后续摸牌顺序 */
function rig(hands: string[], draws: string, dealer = 0): MjState {
  const used = new Set<number>()
  const take = (kind: number) => {
    for (let copy = 0; copy < 4; copy += 1) {
      const id = kind * 4 + copy
      if (!used.has(id)) { used.add(id); return id }
    }
    throw new Error('牌不够')
  }
  const list = (text: string) => parse(text).flatMap((n, kind) => Array.from({ length: n }, () => kind))
  const ids = hands.map((hand) => list(hand).map(take))
  const ordered = draws.split(/\s+/).filter(Boolean).flatMap((part) => list(part)).map(take)
  const rest = allTiles().filter((id) => !used.has(id))
  const deck: number[] = []
  for (let round = 0; round < 13; round += 1) for (let offset = 0; offset < 4; offset += 1) deck.push(ids[(dealer + offset) % 4][round])
  return startFrom([...deck, ...ordered, ...rest], dealer, DEFAULT_OPTIONS)
}
const scores = (state: MjState) => state.players.map((player) => player.score)
const discardKind = (state: MjState, seat: number, kind: number) =>
  applyAction(state, seat, { type: 'discard', tile: state.players[seat].hand.find((tile) => kindOf(tile) === kind) as number })

test('自摸 + 抓鸟 + 杀鬼翻倍', () => {
  // 庄家起手听 5 筒，第一张就摸到；鸟是一万 → 10 分，无红中杀鬼翻倍 → 每家 20
  const state = rig(['123m 456m 789s 111p 5p', '2468m 2468s 2468p 9m', '1357m 1357s 357p 99s', '147m 258s 369p 99m 99p'], '5p 1m')
  assert.equal(choicesFor(state, 0).hu, true)
  applyAction(state, 0, { type: 'hu' })
  assert.equal(state.phase, 'over')
  assert.equal(state.result!.shaGui, true)
  assert.equal(state.result!.birdScore, 10)
  assert.equal(state.result!.perPlayer, 20)
  assert.deepEqual(scores(state), [60, -20, -20, -20])
  assert.equal(state.result!.nextDealer, 0)
})

test('带红中胡牌不翻倍；鸟按点数 + 1', () => {
  const state = rig(['123m 456m 789s 111p 中', '2468m 2468s 2468p 9m', '1357m 1357s 357p 99s', '147m 258s 369p 99m 99p'], '5p 6m')
  applyAction(state, 0, { type: 'hu' })
  assert.equal(state.result!.shaGui, false)
  assert.equal(state.result!.perPlayer, 7, '六万 = 7 分')
  assert.deepEqual(scores(state), [21, -7, -7, -7])
})

test('杠分当场结算：放杠 3 分、暗杠每家 2 分、补杠每家 1 分；没有点炮', () => {
  // 0 号打 5 筒；1 号手里有三张 5 筒 → 放杠，0 号付 3 分
  const state = rig(['123m 456m 789s 12p 5p 9p', '555p 2468m 2468s 99m', '1357m 1357s 37p 99s 1p', '147m 258s 369p 99m 99p'], '8p 6p')
  discardKind(state, 0, 22)
  assert.equal(state.phase, 'claim')
  assert.deepEqual(state.claim, { seat: 1, pung: true, kong: true })
  assert.equal(choicesFor(state, 2).pung, false, '只有一家能碰杠')
  applyAction(state, 1, { type: 'kong' })
  assert.deepEqual(scores(state), [-3, 3, 0, 0])
  assert.equal(state.turn, 1)
  assert.equal(state.players[1].hand.length, 11, '杠后从牌尾补一张')
  assert.equal(state.players[0].discards.length, 0, '被杠走的牌不留在弃牌里')

  // 3 号手握四张 3 条：轮到他时暗杠，三家各付 2 分
  const ankan = rig(['3333s 147m 258s 369p', '2468m 2468s 2468p 9m', '1357m 157s 357p 99s 9m', '123m 456m 789s 12p 5p 9p'], '6p')
  assert.deepEqual(choicesFor(ankan, 0).ankan, [11])
  applyAction(ankan, 0, { type: 'ankan', kind: 11 })
  assert.deepEqual(scores(ankan), [6, -2, -2, -2])

  // 碰了之后摸到第四张：补杠，三家各付 1 分
  const bukan = rig(['123m 456m 789s 12p 5p 9p', '55p 2468m 2468s 99m 1s', '1357m 1357s 37p 99s 1p', '147m 258s 369p 99m 99p'], '8p 8m 7s 4p 5p')
  discardKind(bukan, 0, 22)
  applyAction(bukan, 1, { type: 'pung' })
  assert.equal(bukan.drawn, null)
  assert.equal(choicesFor(bukan, 1).hu, false, '碰牌后只能出牌')
  discardKind(bukan, 1, 9)
  // 2、3、0 号各摸打一张，轮回 1 号摸到第四张 5 筒
  for (const seat of [2, 3, 0]) applyAction(bukan, seat, { type: 'discard', tile: bukan.drawn as unknown as number })
  assert.equal(kindOf(bukan.drawn as unknown as number), 22)
  assert.deepEqual(choicesFor(bukan, 1).bukan, [22])
  applyAction(bukan, 1, { type: 'bukan', kind: 22 })
  assert.deepEqual(scores(bukan), [-1, 3, -1, -1])
  assert.equal(bukan.players[1].melds[0].type, 'bukan')
  assert.equal(bukan.phase, 'play', '没有抢杠胡：补杠后直接补牌继续')
})

test('红中不能被碰杠；流局庄家连庄且杠分保留', () => {
  const state = rig(['123m 456m 789s 12p 9p 中', '中中 2468m 2468s 99m 1s', '1357m 1357s 37p 99s 1p', '147m 258s 369p 99m 99p'], '8p', 0)
  discardKind(state, 0, ZHONG)
  assert.equal(state.phase, 'play')
  assert.equal(state.turn, 1)

  const game = dealGame(2, DEFAULT_OPTIONS, mulberry(11))
  let guard = 0
  while (game.phase !== 'over' && guard < 1000) {
    guard += 1
    const seat = game.phase === 'claim' ? game.claim!.seat : game.turn
    if (game.phase === 'claim') applyAction(game, seat, { type: 'pass' })
    else applyAction(game, seat, { type: 'discard', tile: game.drawn ?? game.players[seat].hand[0] })
  }
  assert.equal(game.result!.winner, -1)
  assert.equal(game.result!.nextDealer, 2)
  assert.equal(game.wall.length, 0)
})

test('随机对局 1500 局：牌数守恒、分数零和、结果合法、可重放', () => {
  const random = mulberry(99)
  let wins = 0
  let kongs = 0
  for (let n = 0; n < 1500; n += 1) {
    const game = dealGame(n % 4, { sevenPairs: n % 2 === 0, fourZhong: true, zhongDiscard: n % 3 !== 0 }, random)
    let steps = 0
    while (game.phase !== 'over') {
      steps += 1
      assert.ok(steps < 600)
      const seat = game.phase === 'claim' ? game.claim!.seat : game.turn
      const choices = choicesFor(game, seat)
      if (game.phase === 'claim') {
        const roll = random()
        applyAction(game, seat, choices.kong && roll < 0.5 ? { type: 'kong' } : roll < 0.8 ? { type: 'pung' } : { type: 'pass' })
      } else if (choices.hu) {
        applyAction(game, seat, { type: 'hu' })
      } else if (choices.ankan.length && random() < 0.7) {
        applyAction(game, seat, { type: 'ankan', kind: choices.ankan[0] })
      } else if (choices.bukan.length && random() < 0.7) {
        applyAction(game, seat, { type: 'bukan', kind: choices.bukan[0] })
      } else {
        // 朝着胡牌的方向打：用进张分析选牌，这样样本里有足够多的胡牌
        const best = analyzeDiscards(countKinds(game.players[seat].hand), game.players[seat].melds.length, remainingFor(game, seat), game.options)
        const pick = best.find((option) => choices.discards.some((tile) => kindOf(tile) === option.kind)) ?? best[0]
        applyAction(game, seat, { type: 'discard', tile: choices.discards.find((tile) => kindOf(tile) === pick.kind) ?? choices.discards[0] })
      }
      // 每一步：112 张牌一张不多一张不少
      const all = [...game.wall, ...game.players.flatMap((p) => [...p.hand, ...p.discards, ...p.melds.flatMap((m) => m.tiles)])]
      const bird = game.result && game.result.bird >= 0 && !all.includes(game.result.bird) ? 1 : 0
      assert.equal(all.length + bird, 112)
      assert.equal(new Set(all).size, all.length)
      assert.equal(game.players.reduce((sum, p) => sum + p.score, 0), 0)
    }
    const result = game.result!
    kongs += game.kongs.length
    if (result.winner >= 0) {
      wins += 1
      const winner = game.players[result.winner]
      assert.ok(canWin(countKinds(winner.hand), winner.melds.length, game.options))
      assert.equal(result.perPlayer, birdScore(kindOf(result.bird)) * (result.shaGui ? 2 : 1))
      assert.equal(result.shaGui, !winner.hand.some((tile) => kindOf(tile) === ZHONG))
      assert.equal(result.nextDealer, result.winner)
    } else {
      assert.equal(result.nextDealer, game.dealer)
    }
    const kongTotal = [0, 1, 2, 3].map((seat) => game.kongs.reduce((sum, kong) => sum + kong.deltas[seat], 0))
    assert.deepEqual(scores(game), kongTotal.map((value, seat) => value + result.winDeltas[seat]))
    // 重放得到完全相同的终局
    const again = replay(game.init, game.events, game.options)
    assert.deepEqual(scores(again), scores(game))
    assert.deepEqual(again.result, game.result)
  }
  assert.ok(wins > 1000, `大多数对局应有人胡牌（${wins}）`)
  assert.ok(kongs > 100, `应出现足够多的杠（${kongs}）`)
})

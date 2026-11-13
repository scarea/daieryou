import test from 'node:test'
import assert from 'node:assert/strict'
import { LH_RULES, TableMeld, checkWin, chiOptions, groupHu, makeGroup } from '../src/shared/liuhu/hand.ts'
import { LhAction, LhState, actorOf, applyLiuhu, choicesFor, dealLiuhu, flipForDealer, fromHands } from '../src/shared/liuhu/game.ts'
import { lhIsRed, lhKind, lhName, redMultiplier } from '../src/shared/liuhu/tiles.ts'

const NAMES = '一二三四五六七八九十壹贰叁肆伍陆柒捌玖拾'

/** 按牌名分配具体的牌，保证整桌不重复 */
function dealer() {
  const used = new Array<number>(20).fill(0)
  const take = (kind: number) => {
    assert.ok(used[kind] < 4, `${lhName(kind)} 用超了`)
    used[kind] += 1
    return kind * 4 + used[kind] - 1
  }
  return {
    tiles: (text: string) => [...text.replace(/\s+/g, '')].map((ch) => take(NAMES.indexOf(ch))),
    /** 剩下的所有牌 */
    rest: () => {
      const tiles: number[] = []
      for (let kind = 0; kind < 20; kind += 1) while (used[kind] < 4) tiles.push(take(kind))
      return tiles
    },
  }
}

const ids = (text: string) => dealer().tiles(text)
const meldOf = (type: TableMeld['type'], text: string, d = dealer()): TableMeld => {
  const tiles = d.tiles(text)
  return { type, kind: lhKind(tiles[0]), tiles, hu: makeGroup(type, tiles.map(lhKind)).hu }
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

test('胡数表：大字 = 小字 + 3，小碰和搭是 0', () => {
  const small = 3
  const big = 13
  assert.deepEqual(['peng', 'kan', 'xiao', 'pao', 'ti'].map((type) => groupHu(type as never, [small])), [0, 3, 3, 6, 9])
  assert.deepEqual(['peng', 'kan', 'xiao', 'pao', 'ti'].map((type) => groupHu(type as never, [big])), [3, 6, 6, 9, 12])
  assert.equal(groupHu('ershi', [1, 6, 9]), 3)
  assert.equal(groupHu('ershi', [11, 16, 19]), 6)
  assert.equal(groupHu('seq', [0, 1, 2]), 3)
  assert.equal(groupHu('seq', [10, 11, 12]), 6)
  assert.equal(groupHu('seq', [3, 4, 5]), 0)
  assert.equal(groupHu('da', [7, 7, 17]), 0)
})

test('红黑倍数', () => {
  assert.deepEqual([0, 1, 2, 7, 8, 9, 10, 14].map((reds) => redMultiplier(reds).mult), [5, 4, 1, 1, 2, 2, 4, 4])
  assert.equal([...NAMES].filter((_, kind) => lhIsRed(kind)).join(''), '二七十贰柒拾')
})

test('胡牌：五门、起胡 6 胡', () => {
  // 一二三(3) + 小坎(3) + 两门搭(0) + 一门顺子(0)，差一张六
  const hand = ids('一二三 十十十 八八捌 九九玖 四五')
  const win = checkWin([], hand, ids('六')[0], true)
  assert.equal(win?.hu, 6)
  // 只有 3 胡：不够起胡
  assert.equal(checkWin([], ids('一二三 四五六 八八捌 九九玖 四五'), ids('六')[0], true), null)
  // 凑不拢
  assert.equal(checkWin([], ids('一二三 十十十 八八捌 九九玖 四七'), ids('六')[0], true), null)
})

test('胡牌：有提 / 跑时是四门加一对将', () => {
  // 小提(9) + 小坎(3) + 一二三(3) + 二七十(3) + 一对
  const d = dealer()
  const melds = [meldOf('ti', '四四四四', d)]
  const hand = d.tiles('五五五 一二三 二七十 九')
  const win = checkWin(melds, hand, d.tiles('九')[0], true)
  assert.equal(win?.hu, 18)
  assert.equal(win?.groups.filter((group) => group.type === 'pair').length, 1)
  // 没有四张的门子时不能有将
  assert.equal(checkWin([], ids('五五五 一二三 二七十 壹壹壹 九'), ids('九')[0], true), null)
})

test('胡牌：自己摸到对子的第三张是笑，别人的是碰', () => {
  const hand = ids('一二三 四五六 七八九 壹壹 二七十')
  assert.equal(checkWin([], hand, ids('壹壹壹')[2], true)?.hu, 3 + 3 + 6)
  assert.equal(checkWin([], hand, ids('壹壹壹')[2], false)?.hu, 3 + 3 + 3)
})

test('胡牌：外来的牌把碰 / 笑升成跑 / 提', () => {
  const d = dealer()
  const melds = [meldOf('xiao', '柒柒柒', d), meldOf('peng', '三三三', d)]
  const hand = d.tiles('一二三 八八')
  const seven = d.tiles('柒')[0]
  // 别人的第四张：跑(9) + 小碰(0) + 一二三(3) + 一对
  assert.equal(checkWin(melds, hand, seven, false)?.hu, 12)
  // 自己摸到第四张加在笑上：提(12)
  assert.equal(checkWin(melds, hand, seven, true)?.hu, 15)
})

test('单吊：只剩一张单牌时只能胡同样的牌做将', () => {
  const d = dealer()
  const melds = [meldOf('pao', '壹壹壹壹', d), meldOf('seq', '一二三', d), meldOf('seq', '四五六', d), meldOf('da', '八八捌', d)]
  const hand = d.tiles('七')
  assert.ok(checkWin(melds, hand, d.tiles('七')[0], false))
  assert.equal(checkWin(melds, hand, d.tiles('八')[0], false), null)
  assert.equal(checkWin(melds, hand, d.tiles('柒')[0], false), null)
})

test('吃牌与下伙', () => {
  const d = dealer()
  // 用二三吃一；手里还有一张一，可以用 一一壹 之外的方式下伙吗？只有 一壹壹 能下
  const hand = d.tiles('一二三 壹壹 九')
  const options = chiOptions(hand, d.tiles('一')[0])
  const text = options.map((option) => option.groups.map((group) => group.map(lhName).sort().join('')).join('+'))
  // 吃成 一二三 后手里还有一：下伙 一壹壹；或者直接吃成 一一壹（手里不再剩一）
  assert.ok(text.some((item) => item.split('+').length === 2))
  assert.ok(text.includes('一一壹'))
  for (const option of options) {
    const kinds = option.groups.flat()
    // 被吃的一 + 手里的一：亮出来的门子里正好两张一
    assert.equal(kinds.filter((kind) => kind === 0).length, 2)
  }
  // 手里还有同样的牌却下不了伙：不能吃
  assert.deepEqual(chiOptions(ids('二三 一 九十'), ids('一一')[1]), [])
  // 起手的坎不能拆来吃
  assert.deepEqual(chiOptions(ids('二二二 三 九'), ids('一')[0]), [])
  // 二七十
  assert.equal(chiOptions(ids('二七 九'), ids('十')[0]).length, 1)
})

/** 把一桌牌补齐：指定的手牌之外，其余座位和墩从剩下的牌里拿 */
function table(hands: string[], wallFirst = ''): LhState {
  const d = dealer()
  const fixed = [0, 1, 2, 3].map((seat) => d.tiles(hands[seat] ?? ''))
  const wall = d.tiles(wallFirst)
  const rest = d.rest()
  const full = fixed.map((hand, seat) => {
    const need = (seat === 0 ? 15 : 14) - hand.length
    assert.ok(need >= 0)
    // 庄家的挡底是手牌最后一张，补的牌插到前面
    return [...rest.splice(0, need), ...hand]
  })
  return fromHands(full, [...wall, ...rest], 0)
}

function conserve(state: LhState): void {
  const all = [
    ...state.wall,
    ...state.players.flatMap((player) => [...player.hand, ...player.discards, ...player.melds.flatMap((meld) => meld.tiles)]),
    ...(state.pending && state.pending.source !== 'open' ? [state.pending.tile] : []),
  ]
  assert.equal(all.length, 80)
  assert.equal(new Set(all).size, 80)
}

test('放炮：一人付三份', () => {
  const state = table([
    '一二三 四五六 七八九 壹贰叁 陆 拾 肆',
    '壹壹壹 贰柒 三四五 六七八 九九玖',
    '一二三四 五六七 十 叁肆伍陆 玖捌',
    '一二三四 五六七 十 叁肆伍陆 玖捌',
  ])
  assert.equal(state.phase, 'discard')
  assert.equal(actorOf(state), 0)
  const tile = state.players[0].hand.find((item) => lhName(lhKind(item)) === '拾') as number
  applyLiuhu(state, 0, { type: 'discard', tile })
  assert.equal(actorOf(state), 1)
  assert.equal(choicesFor(state, 1).hu, true)
  applyLiuhu(state, 1, { type: 'hu' })
  const result = state.result!
  assert.equal(result.kind, 'pao')
  // 大坎 6 + 贰柒拾 6
  assert.equal(result.hu, 12)
  assert.equal(result.redName, '平胡')
  assert.deepEqual(result.deltas, [-36, 36, 0, 0])
  assert.equal(result.nextDealer, 1)
})

test('闲家胡挡底；庄家起手有提当场亮出', () => {
  const state = table([
    '一二三 四五六 七八九 壹贰叁 陆 肆 拾',
    '壹壹壹 贰柒 三四五 六七八 九九玖',
  ])
  assert.equal(state.phase, 'claim')
  assert.equal(actorOf(state), 1)
  applyLiuhu(state, 1, { type: 'hu' })
  assert.equal(state.result!.kind, 'gong')
  assert.deepEqual(state.result!.deltas, [-12, 36, -12, -12])

  const withTi = table(['五五五五 一二三 四六 七八九 壹贰 肆'])
  assert.equal(withTi.players[0].melds[0].type, 'ti')
  assert.equal(withTi.phase, 'discard')
  assert.equal(withTi.players[0].hand.length, 11)
})

test('一跑打一张，重跑不打', () => {
  const state = table([
    '一 三四五 六七八 九十 壹贰叁 陆 拾 肆',
    '一一一 二二二 四五六 七八九 肆伍',
  ], '二 玖')
  const one = state.players[0].hand.find((item) => lhKind(item) === 0) as number
  applyLiuhu(state, 0, { type: 'discard', tile: one })
  // 跑是必须的：自动完成，然后打一张
  assert.equal(state.players[1].melds[0].type, 'pao')
  assert.equal(state.phase, 'discard')
  assert.equal(actorOf(state), 1)
  // 坎不能拆着打
  assert.ok(choicesFor(state, 1).discards.every((tile) => lhKind(tile) !== 1))
  const out = state.players[1].hand.find((item) => lhName(lhKind(item)) === '伍') as number
  applyLiuhu(state, 1, { type: 'discard', tile: out })
  // 把无关的吃碰都放过去，直到 2 号位摸到二
  while ((state.phase as string) === 'claim' && !state.events.some((event) => event.t === 'meld' && event.again)) applyLiuhu(state, actorOf(state), { type: 'pass' })
  const again = state.events.find((event) => event.t === 'meld' && event.again)
  assert.ok(again && again.t === 'meld' && again.seat === 1 && again.type === 'pao')
  // 重跑不打：1 号位手里多留一张，轮到 2 号位摸牌
  const total = state.players[1].hand.length + state.players[1].melds.reduce((sum, meld) => sum + meld.tiles.length, 0)
  assert.equal(total, 15)
  const last = state.events[state.events.length - 1]
  assert.ok(state.events.slice(-3).some((event) => event.t === 'draw' && event.seat === 2), JSON.stringify(last))
  conserve(state)
})

test('能碰没碰成臭牌', () => {
  const state = table([
    '九 九 三四五 六七八 壹贰叁 陆 拾 肆 十',
    '九九 一 三 五 七 贰 肆 陆 捌 拾 十 叁 伍',
  ])
  const nines = state.players[0].hand.filter((item) => lhKind(item) === 8)
  applyLiuhu(state, 0, { type: 'discard', tile: nines[0] })
  assert.equal(choicesFor(state, 1).peng, true)
  applyLiuhu(state, 1, { type: 'pass' })
  assert.deepEqual(state.players[1].stinkPeng, [8])
})

test('首局翻牌定庄', () => {
  for (let seed = 1; seed <= 30; seed += 1) {
    const { rounds, dealer: seat } = flipForDealer(mulberry(seed))
    const last = rounds[rounds.length - 1]
    const ranks = last.tiles.map((tile) => (lhKind(tile) % 10) + 1)
    assert.equal(last.seats[ranks.indexOf(Math.max(...ranks))], seat)
  }
})

test('随机对局：牌不多不少、分数零和、总能打完', () => {
  let wins = 0
  for (let seed = 1; seed <= 400; seed += 1) {
    const random = mulberry(seed)
    const state = dealLiuhu(seed % 4, LH_RULES, random)
    let steps = 0
    while (state.phase !== 'over') {
      steps += 1
      assert.ok(steps < 2000)
      const seat = actorOf(state)
      const choices = choicesFor(state, seat)
      let action: LhAction
      if (choices.hu) action = { type: 'hu' }
      else if (choices.discards.length) action = { type: 'discard', tile: choices.discards[Math.floor(random() * choices.discards.length)] }
      else if (choices.peng && random() < 0.6) action = { type: 'peng' }
      else if (choices.chi.length && random() < 0.6) action = { type: 'chi', option: Math.floor(random() * choices.chi.length) }
      else action = { type: 'pass' }
      applyLiuhu(state, seat, action)
      conserve(state)
      for (const player of state.players) {
        const fours = player.melds.filter((meld) => meld.tiles.length === 4).length
        const total = player.hand.length + player.melds.reduce((sum, meld) => sum + meld.tiles.length, 0)
        assert.ok(total >= 14 && total <= 15 + Math.max(0, fours - 1), `张数不对 ${total}`)
      }
    }
    const result = state.result!
    assert.equal(result.deltas.reduce((sum, delta) => sum + delta, 0), 0)
    if (result.winner >= 0) {
      wins += 1
      assert.ok(result.hu >= 6)
      assert.equal(result.deltas[result.winner], result.share * 3)
      const size = result.groups.reduce((sum, group) => sum + group.kinds.length, 0)
      const fours = result.groups.filter((group) => group.kinds.length === 4).length
      assert.equal(size, 15 + Math.max(0, fours - 1))
      assert.equal(result.groups.filter((group) => group.type === 'pair').length, fours > 0 ? 1 : 0)
      assert.equal(result.hu, result.groups.reduce((sum, group) => sum + group.hu, 0))
    } else {
      assert.equal(result.nextDealer, state.dealer)
    }
  }
  assert.ok(wins > 40, `随机乱打也该有人胡：${wins}`)
})

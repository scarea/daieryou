import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateHand } from '../src/shared/hand.ts'
import {
  advanceRound, allPicked, createGame, finalPlacements, pickCards, settleHands, settleRound, viewFor,
} from '../src/shared/engine.ts'
import { c } from './helpers.ts'

const ev = (text: string) => evaluateHand(text.split(' ').map(c))

test('第二名为输家，向头名与末位各付一笔', () => {
  const s = settleHands([ev('SA HA DA'), ev('S7 H8 D9'), ev('SA HJ D4')], 3)
  assert.deepEqual(s.ranks, [1, 2, 3])
  assert.deepEqual(s.losers, [1])
  assert.deepEqual(s.winners, [0, 2])
  assert.deepEqual(s.deltas, [3, -6, 3])
})

test('豹子对豹子翻倍（README 示例）', () => {
  const s = settleHands([ev('SQ HQ DQ'), ev('S8 H8 D8'), ev('SA HJ D4')], 1)
  assert.deepEqual(s.deltas, [2, -3, 1])
  assert.equal(s.transfers.find((t) => t.to === 0)?.doubled, true)
  assert.equal(s.transfers.find((t) => t.to === 2)?.doubled, false)
})

test('并列情形', () => {
  // 三家全平：不结算
  assert.deepEqual(settleHands([ev('SA HK D3'), ev('DA CK H3'), ev('HA SK C3')], 2).deltas, [0, 0, 0])
  // 并列头名：第三名为输家
  assert.deepEqual(settleHands([ev('SA HK D3'), ev('DA CK H3'), ev('S2 H4 D7')], 2).deltas, [2, 2, -4])
  // 并列第二：两家都向头名付分
  const s = settleHands([ev('SA HA DA'), ev('S2 H4 D7'), ev('D2 C4 H7')], 2)
  assert.deepEqual(s.deltas, [4, -2, -2])
  assert.deepEqual(s.losers, [1, 2])
})

test('完整对局流程：5 轮、摸牌、暗牌、零和', () => {
  for (let game = 0; game < 300; game += 1) {
    const state = createGame(['a', 'b', 'c'])
    assert.equal(state.deck.length, 54 - 15 - 4)
    for (let round = 1; round <= 5; round += 1) {
      assert.equal(state.round, round)
      assert.equal(state.phase, 'selecting')
      const expectedHand = round === 5 ? 3 : 5
      state.players.forEach((p) => assert.equal(p.hand.length, expectedHand))
      // 暗牌在第 4 轮结算前不可见
      if (round <= 4) assert.equal(viewFor(state, 0).publicCards[3], null)
      assert.equal(typeof viewFor(state, 0).seats[1].handCount, 'number')
      if (round < 5) {
        assert.equal(allPicked(state), false)
        state.players.forEach((p, seat) => pickCards(state, seat, [p.hand[seat].id, p.hand[seat + 1].id]))
      }
      const before = state.players.map((p) => p.hand.map((card) => card.id))
      const result = settleRound(state)
      assert.equal(result.entries.reduce((sum, e) => sum + e.delta, 0), 0, '每轮积分零和')
      assert.equal(result.score, round)
      if (round === 4) assert.ok(viewFor(state, 0).publicCards[3], '第 4 轮结算后暗牌翻开')
      advanceRound(state)
      if (round < 5) {
        // 出过的牌不再回手
        state.players.forEach((p, seat) => {
          const playedIds = result.entries[seat].cards.slice(0, 2).map((card) => card.id)
          playedIds.forEach((id) => assert.ok(!p.hand.some((card) => card.id === id)))
          assert.equal(p.hand.length, round < 4 ? 5 : 3)
          assert.equal(p.drawn.length, round < 4 ? 2 : 0)
          assert.ok(before[seat].length >= 3)
        })
      }
    }
    assert.equal(state.phase, 'finished')
    assert.equal(state.players.reduce((sum, p) => sum + p.total, 0), 0)
    // 全局无重复牌
    const all = [...state.deck, ...state.publicCards, ...state.results.flatMap((r) => r.round < 5 ? r.entries.flatMap((e) => e.cards.slice(0, 2)) : r.entries.flatMap((e) => e.cards))]
    assert.equal(new Set(all.map((card) => card.id)).size, all.length)
    assert.equal(all.length, 54)
  }
})

test('输家先摸牌', () => {
  const state = createGame(['a', 'b', 'c'])
  state.players.forEach((p, seat) => pickCards(state, seat, [p.hand[0].id, p.hand[1].id]))
  const result = settleRound(state)
  const top = state.deck.slice(-6).reverse()
  advanceRound(state)
  const order = [...result.losers, ...[0, 1, 2].filter((s) => !result.losers.includes(s))]
  order.forEach((seat, index) => {
    assert.deepEqual(state.players[seat].drawn, [top[index].id, top[index + 3].id])
  })
})

test('选牌校验', () => {
  const state = createGame(['a', 'b', 'c'])
  const hand = state.players[0].hand
  assert.throws(() => pickCards(state, 0, [hand[0].id]))
  assert.throws(() => pickCards(state, 0, [hand[0].id, hand[0].id]))
  assert.throws(() => pickCards(state, 0, [hand[0].id, 'XX']))
  pickCards(state, 0, [hand[0].id, hand[1].id])
  pickCards(state, 0, [hand[1].id, hand[0].id]) // 重复提交相同选择：幂等
  assert.throws(() => pickCards(state, 0, [hand[2].id, hand[1].id]))
  assert.throws(() => settleRound(state))
})

test('整局名次', () => {
  assert.deepEqual(finalPlacements([5, -8, 3]), [1, 3, 2])
  assert.deepEqual(finalPlacements([2, 2, -4]), [1, 1, 2])
})

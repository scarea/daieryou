import test from 'node:test'
import assert from 'node:assert/strict'
import { c } from './helpers.ts'
import { compareHands, evaluateHand } from '../src/shared/hand.ts'

const hand = (text: string) => evaluateHand(text.split(' ').map(c))
const beats = (a: string, b: string) => assert.ok(compareHands(hand(a), hand(b)) > 0, `${a} 应大于 ${b}`)
const ties = (a: string, b: string) => assert.equal(compareHands(hand(a), hand(b)), 0, `${a} 应等于 ${b}`)

test('牌型识别', () => {
  assert.equal(hand('SA HA DA').type, 'leopard')
  assert.equal(hand('S5 S6 S7').type, 'straight_flush')
  assert.equal(hand('HA HK H4').type, 'flush')
  assert.equal(hand('S7 H8 D9').type, 'straight')
  assert.equal(hand('SA HA D4').type, 'pair')
  assert.equal(hand('SA HJ D4').type, 'high_card')
  assert.equal(hand('SA H2 D3').type, 'straight')
  assert.equal(hand('SQ HK DA').type, 'straight')
  assert.equal(hand('SK HA D2').type, 'high_card', 'KA2 不是顺子')
})

test('牌型大小顺序', () => {
  beats('S2 H2 D2', 'SQ SK SA')
  beats('S2 S3 S4', 'HA HK HJ')
  beats('H2 H4 H6', 'SQ HK DA')
  beats('SA H2 D3', 'SA HA DK')
  beats('S2 H2 D3', 'SA HK DJ')
})

test('同牌型比较', () => {
  beats('SA HA DA', 'SK HK DK')
  beats('SQ HK DA', 'SJ HQ DK')
  beats('S2 H3 D4', 'SA H2 D3') // A23 是最小的顺子
  beats('HA H9 H2', 'SK SQ S10')
  beats('HA HK H3', 'SA SQ SJ')
  beats('SA HA D2', 'SK HK DA')
  beats('SK HK DA', 'CK DK DQ')
  beats('SA HK D3', 'SA HQ DJ')
  ties('SA HK D3', 'DA CK H3') // 花色不分大小
})

test('赖子自动取最大牌型', () => {
  assert.equal(hand('JS JB S7').type, 'leopard')
  ties('JS JB S7', 'S7 H7 D7')
  assert.equal(hand('JS SK HK').type, 'leopard')
  assert.equal(hand('JB S5 S7').type, 'straight_flush') // 补 ♠6
  assert.equal(hand('JB SQ SK').type, 'straight_flush')
  ties('JB SQ SK', 'SQ SK SA') // 补 A 而不是 J
  assert.equal(hand('JB S5 H7').type, 'straight') // 补 6
  assert.equal(hand('JB S5 S9').type, 'flush')
  assert.equal(hand('JB S5 H9').type, 'pair')
  ties('JB S5 H9', 'S9 H9 D5')
  assert.equal(hand('JB JS SA').cards.filter((card) => card.wild).length, 2)
})

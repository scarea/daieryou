const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { evaluateHand, compareHands } = require('../src/domain/gameEngine')

// 前端的牌型预览是服务端算法的移植版，这里保证两边对同一手牌给出完全相同的结论
const SUITS = ['spades', 'hearts', 'diamonds', 'clubs']
const DECK = [
  ...SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, index) => ({ suit, rank: index + 1 }))),
  { suit: null, rank: 14 },
  { suit: null, rank: 15 },
]

function randomHand(random) {
  const picked = new Set()
  while (picked.size < 3) {
    picked.add(Math.floor(random() * DECK.length))
  }
  return [...picked].map((index) => DECK[index])
}

function seededRandom(seed) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

test('client hand preview should match server hand evaluation', async () => {
  const modulePath = path.resolve(__dirname, '../../client/src/utils/handPreview.js')
  const preview = await import(pathToFileURL(modulePath).href)
  const random = seededRandom(20261009)

  // 覆盖含赖子的牌型
  const hands = [
    [DECK[52], DECK[53], DECK[0]],
    [DECK[52], DECK[0], DECK[13]],
    [DECK[53], DECK[11], DECK[12]],
  ]
  for (let index = 0; index < 600; index += 1) {
    hands.push(randomHand(random))
  }

  const serverEvaluations = hands.map((hand) => evaluateHand(hand))
  const clientEvaluations = hands.map((hand) => preview.evaluateHand(hand))
  hands.forEach((hand, index) => {
    assert.equal(clientEvaluations[index].type, serverEvaluations[index].type, JSON.stringify(hand))
    assert.equal(clientEvaluations[index].highCard, serverEvaluations[index].highCard, JSON.stringify(hand))
  })

  for (let index = 0; index + 1 < hands.length; index += 2) {
    const serverOrder = Math.sign(compareHands(serverEvaluations[index], serverEvaluations[index + 1]))
    const clientOrder = Math.sign(preview.compareHands(clientEvaluations[index], clientEvaluations[index + 1]))
    assert.equal(clientOrder, serverOrder)
  }

  assert.equal(preview.previewHand([DECK[52], DECK[53], DECK[0]]).text, '豹子 · A')
})

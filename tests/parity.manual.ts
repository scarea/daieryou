// 手动对拍脚本：与旧项目引擎比较牌型与胜负（node --import tsx tests/parity.manual.ts <旧项目路径>）
import { createRequire } from 'node:module'
import { createDeck, shuffle, Card } from '../src/shared/cards.ts'
import { compareHands, evaluateHand } from '../src/shared/hand.ts'
import { settleHands } from '../src/shared/engine.ts'

const oldRoot = process.argv[2]
const require = createRequire(import.meta.url)
const old = require(`${oldRoot}/server/src/domain/gameEngine.js`)
const SUIT = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' } as const
const toOld = (card: Card) => ({ suit: card.suit ? SUIT[card.suit] : null, rank: card.rank })
let mismatches = 0
const N = 200000
for (let i = 0; i < N; i += 1) {
  const deck = shuffle(createDeck())
  // 提高赖子出现概率
  if (i % 3 === 0) { const j = deck.findIndex((card) => card.id === 'JB'); [deck[0], deck[j]] = [deck[j], deck[0]] }
  if (i % 7 === 0) { const j = deck.findIndex((card) => card.id === 'JS'); [deck[1], deck[j]] = [deck[j], deck[1]] }
  const hands = [deck.slice(0, 3), deck.slice(3, 6), deck.slice(6, 9)]
  const mine = hands.map(evaluateHand)
  const theirs = hands.map((h) => old.evaluateHand(h.map(toOld)))
  for (let a = 0; a < 3; a += 1) {
    if (mine[a].type !== theirs[a].type) { mismatches += 1; console.log('type', hands[a].map((x) => x.id), mine[a].type, theirs[a].type) }
    for (let b = a + 1; b < 3; b += 1) {
      if (Math.sign(compareHands(mine[a], mine[b])) !== Math.sign(old.compareHands(theirs[a], theirs[b]))) {
        mismatches += 1
        console.log('cmp', hands[a].map((x) => x.id), hands[b].map((x) => x.id))
      }
    }
  }
  // 结算对拍
  const score = (i % 5) + 1
  const state = { currentRound: 5, maxRounds: 5, publicCards: [], roundResults: [], players: hands.map((h, k) => ({ id: k, username: k, handCards: h.map(toOld), selectedCards: [], roundScores: [], totalScore: 0 })) }
  const originalScores = [1, 2, 3, 4, 5]
  const r = old.calculateRound(state)
  const oldDeltas = [0, 1, 2].map((k) => r.playerResults.find((p: any) => p.playerIndex === k).scoreDelta / originalScores[4])
  const s = settleHands(mine, 1)
  if (oldDeltas.join() !== s.deltas.join()) { mismatches += 1; console.log('settle', hands.map((h) => h.map((x) => x.id).join(' ')), oldDeltas, s.deltas) }
  if (mismatches > 10) break
}
console.log(`对拍 ${N} 组，差异 ${mismatches}`)

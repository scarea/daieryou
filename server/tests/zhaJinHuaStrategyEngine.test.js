const test = require('node:test')
const assert = require('node:assert/strict')
const { ZhaJinHuaStrategyEngine } = require('../src/application/bot/engines/zhaJinHuaStrategyEngine')

function getCardKey(card) {
  return `${card?.suit || 'joker'}:${card?.rank}`
}

function createInput(scoreDelta) {
  return {
    roomId: 'room-strategy',
    round: 2,
    maxRounds: 5,
    opponentCount: 2,
    isPublicCardHidden: false,
    publicCard: { suit: 'spades', rank: 9 },
    knownPublicCards: [{ suit: 'spades', rank: 9 }],
    player: {
      id: 'bot-1',
      username: 'AI-1',
      botDifficulty: 'normal',
      totalScore: scoreDelta,
      handCards: [
        { suit: 'hearts', rank: 12 },
        { suit: 'diamonds', rank: 7 },
        { suit: 'clubs', rank: 3 },
      ],
    },
    playerStates: [
      { id: 'bot-1', username: 'AI-1', totalScore: scoreDelta },
      { id: 'u2', username: 'P2', totalScore: 0 },
      { id: 'u3', username: 'P3', totalScore: 0 },
    ],
  }
}

function patchSimulation(engine) {
  engine.getSimulationCount = () => 64
  engine.simulateCandidate = (pair) => {
    const key = pair.join('-')
    if (key === '0-1') {
      return {
        pair,
        expectedUtility: 0.8,
        winRate: 0.72,
        loseRate: 0.1,
        thirdRate: 0.18,
        averageHandScore: 9_900_000,
        strategicScore: 1.2,
      }
    }
    if (key === '1-2') {
      return {
        pair,
        expectedUtility: 0.2,
        winRate: 0.2,
        loseRate: 0.1,
        thirdRate: 0.7,
        averageHandScore: 5_000_000,
        strategicScore: 1.1,
      }
    }
    return {
      pair,
      expectedUtility: -0.5,
      winRate: 0.3,
      loseRate: 0.35,
      thirdRate: 0.35,
      averageHandScore: 7_000_000,
      strategicScore: 0.4,
    }
  }
}

test('ZhaJinHuaStrategyEngine should prefer low-risk low-card branch when leading', () => {
  const engine = new ZhaJinHuaStrategyEngine({ disableExploration: true })
  patchSimulation(engine)

  const result = engine.decideSelection(createInput(20))
  assert.deepEqual(result.selectedCards, [1, 2])
  assert.equal(result?.meta?.mode, 'conservative')
})

test('ZhaJinHuaStrategyEngine should prefer aggressive branch when trailing', () => {
  const engine = new ZhaJinHuaStrategyEngine({ disableExploration: true })
  patchSimulation(engine)

  const result = engine.decideSelection(createInput(-20))
  assert.deepEqual(result.selectedCards, [0, 1])
  assert.equal(result?.meta?.mode, 'aggressive')
})

test('ZhaJinHuaStrategyEngine should exclude known removed cards from unknown pool', () => {
  const engine = new ZhaJinHuaStrategyEngine({ disableExploration: true })
  const context = engine.createCandidateContext({
    round: 2,
    maxRounds: 5,
    opponentCount: 2,
    knownPublicCards: [{ suit: 'spades', rank: 9 }],
    knownRemovedCards: [
      { suit: 'hearts', rank: 12 },
      { suit: 'clubs', rank: 3 },
    ],
    player: {
      id: 'bot-1',
      handCards: [
        { suit: 'diamonds', rank: 7 },
        { suit: 'spades', rank: 1 },
      ],
    },
    playerStates: [
      { id: 'bot-1', totalScore: 0 },
      { id: 'u2', totalScore: 0 },
      { id: 'u3', totalScore: 0 },
    ],
  })

  const poolKeys = new Set(context.unknownPool.map(getCardKey))
  assert.equal(poolKeys.has('hearts:12'), false)
  assert.equal(poolKeys.has('clubs:3'), false)
  assert.equal(poolKeys.has('spades:9'), false)
  assert.equal(poolKeys.has('diamonds:7'), false)
  assert.equal(poolKeys.has('spades:1'), false)
})

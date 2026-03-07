const test = require('node:test')
const assert = require('node:assert/strict')
const { RuleDecisionProvider } = require('../src/application/bot/providers/ruleDecisionProvider')

function createSequenceRandom(values = []) {
  let index = 0
  return () => {
    if (values.length === 0) {
      return Math.random()
    }
    const value = values[index % values.length]
    index += 1
    return value
  }
}

test('RuleDecisionProvider should choose leopard candidate when public card is known', async () => {
  const provider = new RuleDecisionProvider({
    random: createSequenceRandom([0.03, 0.57, 0.81, 0.19, 0.42]),
    disableExploration: true,
  })

  const result = await provider.decide({
    roomId: 'room-1',
    round: 1,
    maxRounds: 5,
    opponentCount: 2,
    isPublicCardHidden: false,
    publicCard: { suit: 'spades', rank: 12 },
    knownPublicCards: [{ suit: 'spades', rank: 12 }],
    player: {
      id: 'bot-1',
      username: 'AI-1',
      botDifficulty: 'hard',
      totalScore: 0,
      handCards: [
        { suit: 'hearts', rank: 2 },
        { suit: 'diamonds', rank: 14 },
        { suit: 'clubs', rank: 12 },
        { suit: 'diamonds', rank: 12 },
        { suit: 'hearts', rank: 9 },
      ],
    },
    playerStates: [
      { id: 'bot-1', username: 'AI-1', totalScore: 0 },
      { id: 'u2', username: 'P2', totalScore: 0 },
      { id: 'u3', username: 'P3', totalScore: 0 },
    ],
  })

  assert.deepEqual(result.selectedCards, [2, 3])
})

test('RuleDecisionProvider should return empty when hand cards are insufficient', async () => {
  const provider = new RuleDecisionProvider()
  const result = await provider.decide({
    player: {
      handCards: [{ suit: 'hearts', rank: 9 }],
    },
  })

  assert.deepEqual(result.selectedCards, [])
})

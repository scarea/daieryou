const test = require('node:test')
const assert = require('node:assert/strict')
const { createInitialGameState, calculateRound } = require('../src/domain/gameEngine')

function createManualRoundState(playerHands, publicCard) {
  return {
    players: playerHands.map((handCards, index) => ({
      id: `u${index + 1}`,
      username: `P${index + 1}`,
      score: 1000,
      online: true,
      handCards,
      selectedCards: [0, 1],
      hasSelected: true,
      roundScores: [],
      totalScore: 0,
    })),
    deck: [],
    publicCards: [publicCard],
    currentRound: 1,
    maxRounds: 5,
    roundResults: [],
  }
}

test('createInitialGameState should deal cards based on config', () => {
  const players = [
    { id: 'u1', username: 'A', score: 1000, online: true },
    { id: 'u2', username: 'B', score: 1000, online: true },
    { id: 'u3', username: 'C', score: 1000, online: true },
  ]

  const gameState = createInitialGameState(players)
  assert.equal(gameState.players.length, 3)
  gameState.players.forEach((player) => {
    assert.equal(player.handCards.length, 5)
    assert.deepEqual(player.roundScores, [])
  })
  assert.equal(gameState.publicCards.length, 4)
})

test('calculateRound should support round five with four public cards', () => {
  const players = [
    { id: 'u1', username: 'A', score: 1000, online: true },
    { id: 'u2', username: 'B', score: 1000, online: true },
    { id: 'u3', username: 'C', score: 1000, online: true },
  ]

  const gameState = createInitialGameState(players)
  gameState.currentRound = 5
  gameState.players.forEach((player) => {
    player.selectedCards = [0, 1]
  })

  const roundResult = calculateRound(gameState)
  assert.equal(roundResult.round, 5)
  assert.ok(roundResult.publicCard)
  assert.equal(roundResult.playerResults.length, 3)
})

test('calculateRound should treat Ace as high card in non-straight hand', () => {
  const gameState = createManualRoundState(
    [
      [{ suit: 'spades', rank: 1 }, { suit: 'hearts', rank: 9 }],
      [{ suit: 'diamonds', rank: 13 }, { suit: 'clubs', rank: 10 }],
      [{ suit: 'hearts', rank: 4 }, { suit: 'spades', rank: 2 }],
    ],
    { suit: 'clubs', rank: 7 },
  )

  const roundResult = calculateRound(gameState)
  assert.equal(roundResult.playerResults[0].playerIndex, 0)
})

test('calculateRound should compare flush/high-card by second kicker when top card ties', () => {
  const gameState = createManualRoundState(
    [
      [{ suit: 'spades', rank: 1 }, { suit: 'hearts', rank: 9 }],
      [{ suit: 'diamonds', rank: 1 }, { suit: 'clubs', rank: 8 }],
      [{ suit: 'hearts', rank: 13 }, { suit: 'spades', rank: 3 }],
    ],
    { suit: 'clubs', rank: 2 },
  )

  const roundResult = calculateRound(gameState)
  assert.equal(roundResult.playerResults[0].playerIndex, 0)
  assert.equal(roundResult.playerResults[1].playerIndex, 1)
})

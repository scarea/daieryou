const test = require('node:test')
const assert = require('node:assert/strict')
const { createInitialGameState, calculateRound, prepareNextRound } = require('../src/domain/gameEngine')

function createManualRoundState(playerHands, publicCard) {
  return {
    players: playerHands.map((handCards, index) => ({
      id: `u${index + 1}`,
      username: `P${index + 1}`,
      score: 1000,
      online: true,
      handCards,
      playedCards: [],
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

function getCardKey(card) {
  return `${card?.suit || 'joker'}:${card?.rank}`
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
    assert.deepEqual(player.playedCards, [])
    assert.deepEqual(player.roundScores, [])
  })
  assert.equal(gameState.publicCards.length, 4)
})

test('calculateRound should support final round direct compare without public card', () => {
  const gameState = createManualRoundState(
    [
      [{ suit: 'spades', rank: 1 }, { suit: 'hearts', rank: 9 }, { suit: 'clubs', rank: 8 }],
      [{ suit: 'diamonds', rank: 13 }, { suit: 'clubs', rank: 10 }, { suit: 'spades', rank: 5 }],
      [{ suit: 'hearts', rank: 4 }, { suit: 'spades', rank: 2 }, { suit: 'diamonds', rank: 7 }],
    ],
    { suit: 'clubs', rank: 7 },
  )
  gameState.currentRound = 5
  gameState.players.forEach((player) => {
    player.selectedCards = []
  })

  const roundResult = calculateRound(gameState)
  assert.equal(roundResult.round, 5)
  assert.equal(roundResult.publicCard, null)
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

test('prepareNextRound should consume selected cards and draw back to five in early rounds', () => {
  const players = [
    { id: 'u1', username: 'A', score: 1000, online: true },
    { id: 'u2', username: 'B', score: 1000, online: true },
    { id: 'u3', username: 'C', score: 1000, online: true },
  ]
  const gameState = createInitialGameState(players)
  gameState.currentRound = 1
  gameState.players.forEach((player) => {
    player.selectedCards = [0, 1]
    player.hasSelected = true
  })

  prepareNextRound(gameState, 1)

  assert.equal(gameState.currentRound, 2)
  gameState.players.forEach((player) => {
    assert.equal(player.handCards.length, 5)
    assert.equal(player.playedCards.length, 2)
    assert.equal(player.hasSelected, false)
  })
})

test('prepareNextRound should not draw cards before final direct compare round', () => {
  const players = [
    { id: 'u1', username: 'A', score: 1000, online: true },
    { id: 'u2', username: 'B', score: 1000, online: true },
    { id: 'u3', username: 'C', score: 1000, online: true },
  ]
  const gameState = createInitialGameState(players)
  gameState.currentRound = 4
  gameState.players.forEach((player) => {
    player.handCards = player.handCards.slice(0, 5)
    player.selectedCards = [0, 1]
    player.hasSelected = true
  })

  prepareNextRound(gameState, 0)

  assert.equal(gameState.currentRound, 5)
  gameState.players.forEach((player) => {
    assert.equal(player.handCards.length, 3)
    assert.equal(player.playedCards.length >= 2, true)
    assert.equal(player.hasSelected, true)
  })
})

test('played cards should never return to any hand or deck in later rounds', () => {
  const players = [
    { id: 'u1', username: 'A', score: 1000, online: true },
    { id: 'u2', username: 'B', score: 1000, online: true },
    { id: 'u3', username: 'C', score: 1000, online: true },
  ]
  const gameState = createInitialGameState(players)

  for (let round = 1; round <= 4; round += 1) {
    gameState.players.forEach((player) => {
      player.selectedCards = [0, 1]
      player.hasSelected = true
    })

    const roundResult = calculateRound(gameState)
    prepareNextRound(gameState, roundResult.loserIndex)

    const playedCardKeys = new Set(
      gameState.players.flatMap((player) => player.playedCards.map(getCardKey)),
    )
    const handCardKeys = new Set(
      gameState.players.flatMap((player) => player.handCards.map(getCardKey)),
    )
    const deckCardKeys = new Set(gameState.deck.map(getCardKey))

    playedCardKeys.forEach((cardKey) => {
      assert.equal(
        handCardKeys.has(cardKey),
        false,
        `played card ${cardKey} should not reappear in player hands`,
      )
      assert.equal(
        deckCardKeys.has(cardKey),
        false,
        `played card ${cardKey} should not reappear in deck`,
      )
    })

    const allCardKeys = [
      ...gameState.players.flatMap((player) => player.handCards.map(getCardKey)),
      ...gameState.players.flatMap((player) => player.playedCards.map(getCardKey)),
      ...gameState.publicCards.map(getCardKey),
      ...gameState.deck.map(getCardKey),
    ]
    assert.equal(allCardKeys.length, 54)
    assert.equal(new Set(allCardKeys).size, 54)
  }
})

test('joker should act as wildcard and resolve to strongest group automatically', () => {
  const gameState = {
    players: [
      {
        id: 'u1',
        username: 'JokerPlayer',
        score: 1000,
        online: true,
        handCards: [
          { suit: 'clubs', rank: 4 },
          { suit: null, rank: 15 },
        ],
        playedCards: [],
        selectedCards: [0, 1],
        hasSelected: true,
        selectedByTimeout: false,
        roundScores: [],
        totalScore: 0,
      },
      {
        id: 'u2',
        username: 'FlushPlayer',
        score: 1000,
        online: true,
        handCards: [
          { suit: 'clubs', rank: 1 },
          { suit: 'clubs', rank: 5 },
        ],
        playedCards: [],
        selectedCards: [0, 1],
        hasSelected: true,
        selectedByTimeout: false,
        roundScores: [],
        totalScore: 0,
      },
      {
        id: 'u3',
        username: 'PairPlayer',
        score: 1000,
        online: true,
        handCards: [
          { suit: 'hearts', rank: 4 },
          { suit: 'diamonds', rank: 4 },
        ],
        playedCards: [],
        selectedCards: [0, 1],
        hasSelected: true,
        selectedByTimeout: false,
        roundScores: [],
        totalScore: 0,
      },
    ],
    deck: [],
    publicCards: [{ suit: 'clubs', rank: 3 }],
    currentRound: 1,
    maxRounds: 5,
    roundResults: [],
  }

  const result = calculateRound(gameState)
  assert.equal(result.playerResults[0].playerName, 'JokerPlayer')
  assert.equal(result.playerResults[0].evaluation.type, 'straight_flush')
  assert.equal(result.playerResults[1].evaluation.type, 'flush')
})

test('calculateRound should score both first and third as winners with same gain', () => {
  const gameState = createManualRoundState(
    [
      [{ suit: 'spades', rank: 1 }, { suit: 'hearts', rank: 9 }],
      [{ suit: 'diamonds', rank: 13 }, { suit: 'clubs', rank: 10 }],
      [{ suit: 'hearts', rank: 4 }, { suit: 'spades', rank: 2 }],
    ],
    { suit: 'clubs', rank: 7 },
  )

  const roundResult = calculateRound(gameState)
  const winner = gameState.players[roundResult.playerResults[0].playerIndex]
  const loser = gameState.players[roundResult.playerResults[1].playerIndex]
  const third = gameState.players[roundResult.playerResults[2].playerIndex]

  assert.equal(winner.roundScores[0], roundResult.score)
  assert.equal(third.roundScores[0], roundResult.score)
  assert.equal(loser.roundScores[0], -(roundResult.score * 2))
})

test('calculateRound should double transfer only for leopard-vs-leopard settlement', () => {
  const gameState = createManualRoundState(
    [
      [{ suit: 'hearts', rank: 12 }, { suit: 'spades', rank: 12 }, { suit: 'clubs', rank: 12 }],
      [{ suit: 'hearts', rank: 8 }, { suit: 'spades', rank: 8 }, { suit: 'clubs', rank: 8 }],
      [{ suit: 'diamonds', rank: 1 }, { suit: 'diamonds', rank: 11 }, { suit: 'diamonds', rank: 4 }],
    ],
    { suit: 'clubs', rank: 7 },
  )
  gameState.currentRound = 5
  gameState.players.forEach((player) => {
    player.selectedCards = []
  })

  const roundResult = calculateRound(gameState)
  const winner = gameState.players[roundResult.playerResults[0].playerIndex]
  const loser = gameState.players[roundResult.playerResults[1].playerIndex]
  const third = gameState.players[roundResult.playerResults[2].playerIndex]

  assert.equal(roundResult.score, 5)
  assert.equal(roundResult.playerResults[0].evaluation.type, 'leopard')
  assert.equal(roundResult.playerResults[1].evaluation.type, 'leopard')
  assert.equal(roundResult.playerResults[2].evaluation.type, 'flush')
  assert.equal(winner.roundScores[0], 10)
  assert.equal(third.roundScores[0], 5)
  assert.equal(loser.roundScores[0], -15)
  assert.equal(roundResult.playerResults[0].scoreDelta, 10)
  assert.equal(roundResult.playerResults[1].scoreDelta, -15)
  assert.equal(roundResult.playerResults[2].scoreDelta, 5)
})

test('calculateRound should treat wildcard-leopard as leopard for double settlement', () => {
  const gameState = createManualRoundState(
    [
      [{ suit: 'hearts', rank: 12 }, { suit: 'spades', rank: 12 }, { suit: 'clubs', rank: 12 }],
      [{ suit: null, rank: 15 }, { suit: 'clubs', rank: 8 }, { suit: 'diamonds', rank: 8 }],
      [{ suit: 'diamonds', rank: 1 }, { suit: 'diamonds', rank: 11 }, { suit: 'diamonds', rank: 4 }],
    ],
    { suit: 'clubs', rank: 7 },
  )
  gameState.currentRound = 5
  gameState.players.forEach((player) => {
    player.selectedCards = []
  })

  const roundResult = calculateRound(gameState)
  const winner = gameState.players[roundResult.playerResults[0].playerIndex]
  const loser = gameState.players[roundResult.playerResults[1].playerIndex]
  const third = gameState.players[roundResult.playerResults[2].playerIndex]

  assert.equal(roundResult.playerResults[0].evaluation.type, 'leopard')
  assert.equal(roundResult.playerResults[1].evaluation.type, 'leopard')
  assert.equal(winner.roundScores[0], 10)
  assert.equal(third.roundScores[0], 5)
  assert.equal(loser.roundScores[0], -15)
})

test('calculateRound should handle two first-place ties (both winners, one loser)', () => {
  const gameState = createManualRoundState(
    [
      [{ suit: 'hearts', rank: 13 }, { suit: 'spades', rank: 13 }, { suit: 'clubs', rank: 13 }],
      [{ suit: 'diamonds', rank: 13 }, { suit: 'hearts', rank: 13 }, { suit: 'diamonds', rank: 13 }],
      [{ suit: 'diamonds', rank: 1 }, { suit: 'diamonds', rank: 11 }, { suit: 'diamonds', rank: 4 }],
    ],
    { suit: 'clubs', rank: 7 },
  )
  gameState.currentRound = 3

  const roundResult = calculateRound(gameState)

  assert.equal(roundResult.playerResults[0].rank, 1)
  assert.equal(roundResult.playerResults[1].rank, 1)
  assert.equal(roundResult.playerResults[2].rank, 2)
  assert.equal(roundResult.winnerIndexes.length, 2)
  assert.equal(roundResult.loserIndexes.length, 1)
  assert.equal(roundResult.loserIndex, roundResult.playerResults[2].playerIndex)
  assert.equal(gameState.players[roundResult.playerResults[0].playerIndex].roundScores[0], roundResult.score)
  assert.equal(gameState.players[roundResult.playerResults[1].playerIndex].roundScores[0], roundResult.score)
  assert.equal(gameState.players[roundResult.playerResults[2].playerIndex].roundScores[0], -roundResult.score * 2)
})

test('calculateRound should handle two second-place ties (multiple losers)', () => {
  const gameState = createManualRoundState(
    [
      [{ suit: 'hearts', rank: 13 }, { suit: 'spades', rank: 13 }, { suit: 'clubs', rank: 13 }],
      [{ suit: 'diamonds', rank: 10 }, { suit: 'hearts', rank: 9 }, { suit: 'clubs', rank: 8 }],
      [{ suit: 'spades', rank: 10 }, { suit: 'diamonds', rank: 9 }, { suit: 'hearts', rank: 8 }],
    ],
    { suit: 'clubs', rank: 7 },
  )
  gameState.currentRound = 2

  const roundResult = calculateRound(gameState)

  assert.equal(roundResult.playerResults[0].rank, 1)
  assert.equal(roundResult.playerResults[1].rank, 2)
  assert.equal(roundResult.playerResults[2].rank, 2)
  assert.equal(roundResult.winnerIndexes.length, 1)
  assert.equal(roundResult.loserIndexes.length, 2)
  assert.ok(roundResult.loserIndexes.includes(roundResult.playerResults[1].playerIndex))
  assert.ok(roundResult.loserIndexes.includes(roundResult.playerResults[2].playerIndex))
  assert.equal(gameState.players[roundResult.playerResults[0].playerIndex].roundScores[0], roundResult.score * 2)
  assert.equal(gameState.players[roundResult.playerResults[1].playerIndex].roundScores[0], -roundResult.score)
  assert.equal(gameState.players[roundResult.playerResults[2].playerIndex].roundScores[0], -roundResult.score)
})


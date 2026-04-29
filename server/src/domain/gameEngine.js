const gameConfig = require('../../config/game-config.json')

const SUITS = {
  SPADES: 'spades',
  HEARTS: 'hearts',
  DIAMONDS: 'diamonds',
  CLUBS: 'clubs',
}

const RANKS = {
  ACE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  SEVEN: 7,
  EIGHT: 8,
  NINE: 9,
  TEN: 10,
  JACK: 11,
  QUEEN: 12,
  KING: 13,
  JOKER_SMALL: 14,
  JOKER_BIG: 15,
}

const HAND_TYPES = {
  LEOPARD: 'leopard',
  STRAIGHT_FLUSH: 'straight_flush',
  FLUSH: 'flush',
  STRAIGHT: 'straight',
  PAIR: 'pair',
  HIGH_CARD: 'high_card',
}

const HAND_TYPE_WEIGHTS = {
  [HAND_TYPES.LEOPARD]: 6,
  [HAND_TYPES.STRAIGHT_FLUSH]: 5,
  [HAND_TYPES.FLUSH]: 4,
  [HAND_TYPES.STRAIGHT]: 3,
  [HAND_TYPES.PAIR]: 2,
  [HAND_TYPES.HIGH_CARD]: 1,
}
const DIRECT_COMPARE_ROUND_GAP = 1
const EVALUATION_CACHE_MAX_SIZE = 60000
const evaluationCache = new Map()

function createWildcardReplacementCards() {
  const cards = []
  Object.values(SUITS).forEach((suit) => {
    for (let rank = RANKS.ACE; rank <= RANKS.KING; rank += 1) {
      cards.push({ suit, rank })
    }
  })
  return cards
}

const WILDCARD_REPLACEMENT_CARDS = createWildcardReplacementCards()

function createDeck() {
  const deck = []

  Object.values(SUITS).forEach((suit) => {
    for (let rank = RANKS.ACE; rank <= RANKS.KING; rank += 1) {
      deck.push({ suit, rank })
    }
  })

  deck.push({ suit: null, rank: RANKS.JOKER_SMALL })
  deck.push({ suit: null, rank: RANKS.JOKER_BIG })

  return deck
}

function shuffleDeck(deck) {
  const shuffled = [...deck]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]
  }
  return shuffled
}

function compareRanks(rank1, rank2) {
  let normalizedRank1 = rank1
  let normalizedRank2 = rank2

  if (normalizedRank1 >= RANKS.JOKER_SMALL) normalizedRank1 += 100
  if (normalizedRank2 >= RANKS.JOKER_SMALL) normalizedRank2 += 100
  if (normalizedRank1 === RANKS.ACE) normalizedRank1 = 14
  if (normalizedRank2 === RANKS.ACE) normalizedRank2 = 14

  return normalizedRank1 - normalizedRank2
}

function sortCardsByStrength(cards) {
  return [...cards].sort((cardA, cardB) => compareRanks(cardB.rank, cardA.rank))
}

function compareRankVectors(vector1 = [], vector2 = []) {
  const length = Math.min(vector1.length, vector2.length)
  for (let index = 0; index < length; index += 1) {
    if (vector1[index] !== vector2[index]) {
      return compareRanks(vector1[index], vector2[index])
    }
  }

  return 0
}

function isLeopard(cards) {
  return cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank
}

function isFlush(cards) {
  const normalCards = cards.filter((card) => card.suit !== null)
  if (normalCards.length < 3) {
    return false
  }

  return normalCards.every((card) => card.suit === normalCards[0].suit)
}

function isStraight(cards) {
  const normalCards = cards.filter((card) => card.suit !== null)
  if (normalCards.length < 3) {
    return false
  }

  const ranks = normalCards.map((card) => card.rank).sort((a, b) => a - b)
  if (ranks[2] - ranks[0] === 2 && ranks[1] - ranks[0] === 1) {
    return true
  }

  return (
    (ranks[0] === 1 && ranks[1] === 2 && ranks[2] === 3) ||
    (ranks[0] === 1 && ranks[1] === 12 && ranks[2] === 13)
  )
}

function getHighCardForStraight(cards) {
  const ranks = cards.filter((card) => card.suit !== null).map((card) => card.rank).sort((a, b) => a - b)
  if (ranks[0] === 1 && ranks[1] === 2 && ranks[2] === 3) return 3
  if (ranks[0] === 1 && ranks[1] === 12 && ranks[2] === 13) return 14
  return Math.max(...ranks)
}

function isPair(cards) {
  const ranks = cards.map((card) => card.rank)
  return ranks[0] === ranks[1] || ranks[1] === ranks[2] || ranks[0] === ranks[2]
}

function getPairRank(cards) {
  const ranks = cards.map((card) => card.rank)
  if (ranks[0] === ranks[1]) return ranks[0]
  if (ranks[1] === ranks[2]) return ranks[1]
  if (ranks[0] === ranks[2]) return ranks[0]
  return null
}

function isWildcardCard(card) {
  return Number(card?.rank) >= RANKS.JOKER_SMALL
}

function getCardCacheKey(card = {}) {
  return `${card.suit || 'joker'}:${card.rank}`
}

function getEvaluationCacheKey(cards = []) {
  return cards.map((card) => getCardCacheKey(card)).sort().join('|')
}

function evaluateNaturalHand(cards) {
  if (cards.length !== 3) {
    throw new Error('炸金花必须是3张牌')
  }

  const sortedCards = sortCardsByStrength(cards)
  const rankVector = sortedCards.map((card) => card.rank)
  if (isLeopard(sortedCards)) {
    return { type: HAND_TYPES.LEOPARD, weight: HAND_TYPE_WEIGHTS[HAND_TYPES.LEOPARD], highCard: sortedCards[0].rank, cards: sortedCards }
  }
  if (isFlush(sortedCards) && isStraight(sortedCards)) {
    return { type: HAND_TYPES.STRAIGHT_FLUSH, weight: HAND_TYPE_WEIGHTS[HAND_TYPES.STRAIGHT_FLUSH], highCard: getHighCardForStraight(sortedCards), cards: sortedCards }
  }
  if (isFlush(sortedCards)) {
    return { type: HAND_TYPES.FLUSH, weight: HAND_TYPE_WEIGHTS[HAND_TYPES.FLUSH], highCard: sortedCards[0].rank, rankVector, cards: sortedCards }
  }
  if (isStraight(sortedCards)) {
    return { type: HAND_TYPES.STRAIGHT, weight: HAND_TYPE_WEIGHTS[HAND_TYPES.STRAIGHT], highCard: getHighCardForStraight(sortedCards), cards: sortedCards }
  }
  if (isPair(sortedCards)) {
    const pairRank = getPairRank(sortedCards)
    const kicker = sortedCards.find((card) => card.rank !== pairRank).rank
    return { type: HAND_TYPES.PAIR, weight: HAND_TYPE_WEIGHTS[HAND_TYPES.PAIR], highCard: pairRank, kicker, cards: sortedCards }
  }
  return { type: HAND_TYPES.HIGH_CARD, weight: HAND_TYPE_WEIGHTS[HAND_TYPES.HIGH_CARD], highCard: sortedCards[0].rank, rankVector, cards: sortedCards }
}

function pickBestWildcardEvaluation(baseCards, wildcardCount) {
  let bestEvaluation = null
  const pickedCards = []

  const search = (depth) => {
    if (depth >= wildcardCount) {
      const candidateEvaluation = evaluateNaturalHand([...baseCards, ...pickedCards])
      if (!bestEvaluation || compareHands(candidateEvaluation, bestEvaluation) > 0) {
        bestEvaluation = candidateEvaluation
      }
      return
    }

    WILDCARD_REPLACEMENT_CARDS.forEach((replacementCard) => {
      pickedCards.push(replacementCard)
      search(depth + 1)
      pickedCards.pop()
    })
  }

  search(0)
  return bestEvaluation
}

function evaluateHand(cards) {
  if (cards.length !== 3) {
    throw new Error('炸金花必须是3张牌')
  }

  const cacheKey = getEvaluationCacheKey(cards)
  const cachedEvaluation = evaluationCache.get(cacheKey)
  if (cachedEvaluation) {
    return cachedEvaluation
  }

  const wildcardCount = cards.filter((card) => isWildcardCard(card)).length
  const evaluation = wildcardCount > 0
    ? pickBestWildcardEvaluation(
      cards.filter((card) => !isWildcardCard(card)),
      wildcardCount,
    )
    : evaluateNaturalHand(cards)

  if (!evaluation) {
    throw new Error('牌型评估失败')
  }

  if (evaluationCache.size >= EVALUATION_CACHE_MAX_SIZE) {
    evaluationCache.clear()
  }
  evaluationCache.set(cacheKey, evaluation)
  return evaluation
}

function compareHands(hand1, hand2) {
  if (hand1.weight !== hand2.weight) {
    return hand1.weight - hand2.weight
  }
  if (hand1.highCard !== hand2.highCard) {
    return compareRanks(hand1.highCard, hand2.highCard)
  }
  if (hand1.type === HAND_TYPES.PAIR && hand1.kicker !== hand2.kicker) {
    return compareRanks(hand1.kicker, hand2.kicker)
  }
  if (
    (hand1.type === HAND_TYPES.HIGH_CARD || hand1.type === HAND_TYPES.FLUSH)
    && hand1.rankVector
    && hand2.rankVector
  ) {
    return compareRankVectors(hand1.rankVector, hand2.rankVector)
  }
  return 0
}

function isSelectionRequiredRound(currentRound, maxRounds = gameConfig.gameRounds) {
  return Number(currentRound) < Number(maxRounds) - 0
}

function isFinalDirectCompareRound(currentRound, maxRounds = gameConfig.gameRounds) {
  return Number(currentRound) === Number(maxRounds)
}

function normalizePriorityIndexes(priorityIndexes, playerCount) {
  const normalizedPlayerCount = Number(playerCount) || 0
  const rawIndexes = Array.isArray(priorityIndexes)
    ? priorityIndexes
    : [priorityIndexes]
  const uniqueIndexes = []
  const indexSet = new Set()

  rawIndexes.forEach((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= normalizedPlayerCount || indexSet.has(index)) {
      return
    }
    indexSet.add(index)
    uniqueIndexes.push(index)
  })

  return uniqueIndexes
}

function buildDrawOrder(playerCount, priorityIndexes) {
  const normalizedPlayerCount = Number(playerCount) || 0
  const prioritized = normalizePriorityIndexes(priorityIndexes, normalizedPlayerCount)
  const prioritizedSet = new Set(prioritized)
  const order = [...prioritized]

  for (let index = 0; index < normalizedPlayerCount; index += 1) {
    if (!prioritizedSet.has(index)) {
      order.push(index)
    }
  }

  return order
}

function consumeSelectedCardsForRound(gameState, round) {
  if (!isSelectionRequiredRound(round, gameState.maxRounds)) {
    return
  }

  gameState.players.forEach((player) => {
    const handCards = Array.isArray(player.handCards) ? player.handCards : []
    const selectedIndices = Array.isArray(player.selectedCards)
      ? Array.from(new Set(player.selectedCards))
      : []
    const sortedIndices = selectedIndices
      .filter((cardIndex) => Number.isInteger(cardIndex) && cardIndex >= 0 && cardIndex < handCards.length)
      .sort((left, right) => right - left)

    const playedCards = []
    sortedIndices.forEach((cardIndex) => {
      const [removedCard] = handCards.splice(cardIndex, 1)
      if (removedCard) {
        playedCards.push(removedCard)
      }
    })

    player.playedCards = [...(Array.isArray(player.playedCards) ? player.playedCards : []), ...playedCards.reverse()]
    player.handCards = handCards
  })
}

function drawCardsForNextRound(gameState, priorityIndexes, drawCount = 2) {
  const order = buildDrawOrder(gameState.players.length, priorityIndexes)
  for (let round = 0; round < drawCount; round += 1) {
    order.forEach((playerIndex) => {
      if (gameState.deck.length > 0) {
        gameState.players[playerIndex].handCards.push(gameState.deck.pop())
      }
    })
  }
}

function createInitialGameState(players, options = {}) {
  const deck = shuffleDeck(createDeck())
  const selectionTimeoutMs = Number.isInteger(options.selectionTimeoutMs) && options.selectionTimeoutMs > 0
    ? options.selectionTimeoutMs
    : 30000
  const gameState = {
    players: players.map((player) => ({
      ...player,
      handCards: [],
      playedCards: [],
      selectedCards: [],
      hasSelected: false,
      selectedByTimeout: false,
      roundScores: [],
      totalScore: 0,
    })),
    deck,
    publicCards: [],
    currentRound: 1,
    maxRounds: gameConfig.gameRounds,
    selectionTimeoutMs,
    roundDeadlineAt: null,
    roundResults: [],
    phase: 'selecting',
    actionSeq: 0,
    lastAction: {
      type: 'deal',
      round: 1,
      seq: 0,
      at: Date.now(),
    },
  }

  for (let cardIndex = 0; cardIndex < gameConfig.handCardsCount; cardIndex += 1) {
    for (let playerIndex = 0; playerIndex < gameState.players.length; playerIndex += 1) {
      gameState.players[playerIndex].handCards.push(gameState.deck.pop())
    }
  }

  for (let publicIndex = 0; publicIndex < gameConfig.publicCardsCount; publicIndex += 1) {
    gameState.publicCards.push(gameState.deck.pop())
  }

  return gameState
}

function calculateRound(gameState) {
  const currentRound = gameState.currentRound
  const maxRounds = gameState.maxRounds || gameConfig.gameRounds
  const isSelectionRound = isSelectionRequiredRound(currentRound, maxRounds)
  const publicCardIndex = Math.min(currentRound - 1, gameState.publicCards.length - 1)
  const publicCard = isSelectionRound
    ? gameState.publicCards[publicCardIndex]
    : null
  const hiddenPublicCardRound = maxRounds - DIRECT_COMPARE_ROUND_GAP
  const isHiddenCard = currentRound === hiddenPublicCardRound

  const evaluations = gameState.players.map((player, playerIndex) => {
    let hand = []
    if (isSelectionRound) {
      const selectedIndices = Array.isArray(player.selectedCards)
        ? player.selectedCards
        : []
      const selectedHandCards = selectedIndices.map((index) => player.handCards[index]).filter(Boolean)
      hand = [...selectedHandCards, publicCard].filter(Boolean)
    } else {
      const currentHand = Array.isArray(player.handCards) ? player.handCards : []
      hand = currentHand.slice(0, 3)
    }

    if (hand.length !== 3) {
      throw new Error('回合牌面数量异常')
    }

    const evaluation = evaluateHand(hand)
    const resolvedHand = Array.isArray(evaluation?.cards) && evaluation.cards.length === 3
      ? evaluation.cards
      : hand

    return { playerIndex, hand: resolvedHand, evaluation }
  })

  evaluations.sort((left, right) => compareHands(right.evaluation, left.evaluation))

  const evaluationGroups = []
  evaluations.forEach((entry) => {
    const lastGroup = evaluationGroups[evaluationGroups.length - 1]
    if (!lastGroup || compareHands(entry.evaluation, lastGroup.evaluation) !== 0) {
      evaluationGroups.push({
        evaluation: entry.evaluation,
        entries: [entry],
      })
      return
    }

    lastGroup.entries.push(entry)
  })

  const firstGroupEntries = evaluationGroups[0]?.entries || []
  const secondGroupEntries = evaluationGroups[1]?.entries || []
  const thirdGroupEntries = evaluationGroups[2]?.entries || []

  let winnerEntries = []
  let loserEntries = []
  if (firstGroupEntries.length >= 3 || secondGroupEntries.length === 0) {
    winnerEntries = []
    loserEntries = []
  } else if (firstGroupEntries.length >= 2) {
    winnerEntries = firstGroupEntries
    loserEntries = secondGroupEntries.slice(0, 1)
  } else if (secondGroupEntries.length >= 2) {
    winnerEntries = firstGroupEntries
    loserEntries = secondGroupEntries
  } else {
    winnerEntries = [...firstGroupEntries, ...thirdGroupEntries]
    loserEntries = secondGroupEntries
  }

  const winnerIndexes = winnerEntries.map((entry) => entry.playerIndex)
  const loserIndexes = loserEntries.map((entry) => entry.playerIndex)
  const loserIndex = loserIndexes.length > 0 ? loserIndexes[0] : -1
  const roundScore = gameConfig.roundScores[currentRound - 1]
  const evaluationByPlayerIndex = new Map(
    evaluations.map((entry) => [entry.playerIndex, entry.evaluation]),
  )

  const getSettlementScore = (fromPlayerIndex, toPlayerIndex) => {
    const fromType = evaluationByPlayerIndex.get(fromPlayerIndex)?.type
    const toType = evaluationByPlayerIndex.get(toPlayerIndex)?.type
    const shouldDouble = fromType === HAND_TYPES.LEOPARD && toType === HAND_TYPES.LEOPARD
    return roundScore * (shouldDouble ? 2 : 1)
  }

  const scoreDeltaByPlayerIndex = new Map(
    gameState.players.map((_, index) => [index, 0]),
  )
  loserIndexes.forEach((fromIndex) => {
    winnerIndexes.forEach((toIndex) => {
      const settlementScore = getSettlementScore(fromIndex, toIndex)
      scoreDeltaByPlayerIndex.set(toIndex, (scoreDeltaByPlayerIndex.get(toIndex) || 0) + settlementScore)
      scoreDeltaByPlayerIndex.set(fromIndex, (scoreDeltaByPlayerIndex.get(fromIndex) || 0) - settlementScore)
    })
  })

  gameState.players.forEach((player, playerIndex) => {
    const scoreDelta = scoreDeltaByPlayerIndex.get(playerIndex) || 0
    player.roundScores.push(scoreDelta)
    player.totalScore += scoreDelta
  })

  const rankByPlayerIndex = new Map()
  evaluationGroups.forEach((group, groupIndex) => {
    const rank = groupIndex + 1
    group.entries.forEach((entry) => {
      rankByPlayerIndex.set(entry.playerIndex, rank)
    })
  })

  const roundResult = {
    round: currentRound,
    publicCard: isSelectionRound ? publicCard : null,
    playerResults: evaluations.map((entry) => ({
      playerIndex: entry.playerIndex,
      playerId: gameState.players[entry.playerIndex].id,
      playerName: gameState.players[entry.playerIndex].username,
      hand: entry.hand,
      evaluation: entry.evaluation,
      selectedByTimeout: gameState.players[entry.playerIndex].selectedByTimeout === true,
      scoreDelta: scoreDeltaByPlayerIndex.get(entry.playerIndex) || 0,
      rank: rankByPlayerIndex.get(entry.playerIndex) || 1,
    })),
    winnerIndexes,
    loserIndex,
    loserIndexes,
    score: roundScore,
  }

  gameState.roundResults.push(roundResult)
  return roundResult
}

function prepareNextRound(gameState, loserIndexes) {
  const previousRound = gameState.currentRound
  consumeSelectedCardsForRound(gameState, previousRound)
  gameState.currentRound += 1
  gameState.roundDeadlineAt = null
  gameState.players.forEach((player) => {
    player.selectedCards = []
    player.hasSelected = !isSelectionRequiredRound(gameState.currentRound, gameState.maxRounds)
    player.selectedByTimeout = false
  })

  const shouldDrawForNextRound = previousRound < (gameState.maxRounds - DIRECT_COMPARE_ROUND_GAP)
  if (!shouldDrawForNextRound) {
    return
  }

  drawCardsForNextRound(gameState, loserIndexes, 2)
}

function getPublicGameState(gameState, currentPlayerId = null) {
  const maxRounds = gameState.maxRounds || gameConfig.gameRounds
  const hiddenPublicCardRound = maxRounds - DIRECT_COMPARE_ROUND_GAP
  const hiddenPublicCardIndex = hiddenPublicCardRound - 1
  const visiblePublicCards = Array.isArray(gameState.publicCards)
    ? gameState.publicCards.map((card, index) => (index === hiddenPublicCardIndex ? null : card))
    : []
  return {
    ...gameState,
    publicCards: visiblePublicCards,
    players: gameState.players.map((player) => ({
      ...player,
      handCards: player.id === currentPlayerId ? player.handCards : player.handCards.length,
      playedCards: player.id === currentPlayerId ? player.playedCards : player.playedCards.length,
    })),
    deck: gameState.deck.length,
    hiddenPublicCardIndex: hiddenPublicCardIndex >= 0 ? hiddenPublicCardIndex : null,
    selectionRequired: isSelectionRequiredRound(gameState.currentRound, gameState.maxRounds),
  }
}

module.exports = {
  createInitialGameState,
  calculateRound,
  prepareNextRound,
  getPublicGameState,
  evaluateHand,
  compareHands,
  isSelectionRequiredRound,
  isFinalDirectCompareRound,
}

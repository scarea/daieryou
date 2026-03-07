const gameConfig = require('../../../../config/game-config.json')
const { evaluateHand, compareHands } = require('../../../domain/gameEngine')

const BOT_DIFFICULTIES = new Set(['easy', 'normal', 'hard'])
const DIFFICULTY_TOTAL_SIMULATIONS = {
  easy: 900,
  normal: 1800,
  hard: 3000,
}
const DIFFICULTY_WIN_MULTIPLIER = {
  easy: 1,
  normal: 1.05,
  hard: 1.12,
}
const DIFFICULTY_LOSE_MULTIPLIER = {
  easy: 1,
  normal: 1.2,
  hard: 1.4,
}
const DIFFICULTY_EXPLORATION_RATE = {
  easy: 0.38,
  normal: 0.16,
  hard: 0.04,
}
const DIFFICULTY_EXPLORATION_POOL = {
  easy: 4,
  normal: 2,
  hard: 2,
}
const DIFFICULTY_RISK_WEIGHT = {
  easy: 0.08,
  normal: 0.16,
  hard: 0.3,
}
const DIFFICULTY_WIN_WEIGHT = {
  easy: 0.12,
  normal: 0.2,
  hard: 0.3,
}
const DIFFICULTY_THIRD_WEIGHT = {
  easy: 0.16,
  normal: 0.24,
  hard: 0.28,
}
const DIFFICULTY_RESERVE_WEIGHT = {
  easy: 0.22,
  normal: 0.3,
  hard: 0.34,
}
const MIN_SIMULATIONS_PER_CANDIDATE = 32
const MAX_SIMULATIONS_PER_CANDIDATE = 220

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs']

function createFullDeck() {
  const deck = []
  SUITS.forEach((suit) => {
    for (let rank = 1; rank <= 13; rank += 1) {
      deck.push({ suit, rank })
    }
  })

  deck.push({ suit: null, rank: 14 })
  deck.push({ suit: null, rank: 15 })
  return deck
}

function getCardKey(card = {}) {
  const suit = card.suit == null ? 'joker' : card.suit
  return `${suit}:${card.rank}`
}

function normalizeDifficulty(value) {
  if (typeof value !== 'string') {
    return 'normal'
  }

  const normalized = value.trim().toLowerCase()
  return BOT_DIFFICULTIES.has(normalized) ? normalized : 'normal'
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function normalizeRankForScore(rank) {
  const numeric = Number(rank)
  if (!Number.isFinite(numeric)) {
    return 0
  }
  if (numeric >= 14) {
    return numeric + 100
  }
  if (numeric === 1) {
    return 14
  }
  return numeric
}

function getHandScore(evaluation = {}) {
  const typeScore = Number(evaluation.weight || 0) * 1_000_000
  const highCardScore = normalizeRankForScore(evaluation.highCard) * 10_000
  const kickerScore = normalizeRankForScore(evaluation.kicker) * 100
  const rankVectorScore = Array.isArray(evaluation.rankVector)
    ? evaluation.rankVector.reduce((sum, rank, index) => (
      sum + (normalizeRankForScore(rank) * (10 / (index + 1)))
    ), 0)
    : 0

  return typeScore + highCardScore + kickerScore + rankVectorScore
}

function getRoundScore(round) {
  const index = clamp(Number(round || 1) - 1, 0, gameConfig.roundScores.length - 1)
  const value = Number(gameConfig.roundScores[index])
  return Number.isFinite(value) && value > 0 ? value : 1
}

function buildPairIndices(handCards = []) {
  const pairs = []
  for (let left = 0; left < handCards.length - 1; left += 1) {
    for (let right = left + 1; right < handCards.length; right += 1) {
      pairs.push([left, right])
    }
  }
  return pairs
}

function countRemainingRounds(currentRound, maxRounds) {
  const current = Number.isFinite(currentRound) ? currentRound : 1
  const max = Number.isFinite(maxRounds) ? maxRounds : gameConfig.gameRounds
  return Math.max(1, max - current + 1)
}

function isSamePair(left = [], right = []) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === 2
    && right.length === 2
    && left[0] === right[0]
    && left[1] === right[1]
}

function removePairFromCards(handCards = [], pair = []) {
  const [leftIndex, rightIndex] = pair
  return handCards.filter((_, index) => index !== leftIndex && index !== rightIndex)
}

class ZhaJinHuaStrategyEngine {
  constructor({
    random = Math.random,
    disableExploration = false,
  } = {}) {
    this.random = typeof random === 'function' ? random : Math.random
    this.disableExploration = disableExploration === true
    this.fullDeck = createFullDeck()
  }

  randomIndex(length) {
    if (!Number.isInteger(length) || length <= 0) {
      return 0
    }

    const value = this.random()
    if (!Number.isFinite(value)) {
      return 0
    }
    return Math.min(length - 1, Math.max(0, Math.floor(value * length)))
  }

  pickDistinctIndices(length, count, blockedIndex = null) {
    if (!Number.isInteger(length) || length <= 0 || !Number.isInteger(count) || count <= 0) {
      return []
    }

    const blocked = new Set()
    if (Number.isInteger(blockedIndex) && blockedIndex >= 0 && blockedIndex < length) {
      blocked.add(blockedIndex)
    }

    const picked = []
    const maxAttempts = length * 12
    let attempts = 0
    while (picked.length < count && attempts < maxAttempts) {
      attempts += 1
      const next = this.randomIndex(length)
      if (blocked.has(next)) {
        continue
      }
      blocked.add(next)
      picked.push(next)
    }

    if (picked.length < count) {
      for (let index = 0; index < length && picked.length < count; index += 1) {
        if (blocked.has(index)) {
          continue
        }
        blocked.add(index)
        picked.push(index)
      }
    }

    return picked
  }

  buildUnknownPool({ handCards, knownPublicCards, knownRemovedCards }) {
    const knownSet = new Set()
    const mergeCards = (cards) => {
      if (!Array.isArray(cards)) {
        return
      }
      cards.forEach((card) => {
        knownSet.add(getCardKey(card))
      })
    }

    mergeCards(handCards)
    mergeCards(knownPublicCards)
    mergeCards(knownRemovedCards)

    return this.fullDeck.filter((card) => !knownSet.has(getCardKey(card)))
  }

  buildScorePressure(input = {}) {
    const players = Array.isArray(input.playerStates) ? input.playerStates : []
    const playerId = input?.player?.id
    const selfScore = Number(players.find((item) => item?.id === playerId)?.totalScore || 0)
    const opponentScores = players
      .filter((item) => item?.id !== playerId)
      .map((item) => Number(item?.totalScore || 0))
    const opponentAverage = opponentScores.length > 0
      ? opponentScores.reduce((sum, item) => sum + item, 0) / opponentScores.length
      : 0
    const roundsLeft = countRemainingRounds(
      Number(input.round || 1),
      Number(input.maxRounds || gameConfig.gameRounds),
    )

    return {
      scoreDelta: selfScore - opponentAverage,
      roundsLeft,
    }
  }

  createCandidateContext(input = {}) {
    const handCards = Array.isArray(input?.player?.handCards) ? input.player.handCards : []
    const knownPublicCards = Array.isArray(input.knownPublicCards) ? input.knownPublicCards : []
    const knownRemovedCards = Array.isArray(input.knownRemovedCards) ? input.knownRemovedCards : []
    const remainingPublicCards = Array.isArray(input.remainingPublicCards) ? input.remainingPublicCards : []
    const unknownPool = this.buildUnknownPool({ handCards, knownPublicCards, knownRemovedCards })
    const difficulty = normalizeDifficulty(input?.player?.botDifficulty || input?.difficulty)
    const round = Number.isFinite(Number(input.round)) ? Number(input.round) : 1
    const maxRounds = Number.isFinite(Number(input.maxRounds)) ? Number(input.maxRounds) : gameConfig.gameRounds
    const opponentCount = Math.max(0, Number(input.opponentCount || 2))
    const roundScore = getRoundScore(round)
    const futureScoreTotal = (() => {
      let sum = 0
      for (let cursor = round + 1; cursor <= maxRounds; cursor += 1) {
        sum += getRoundScore(cursor)
      }
      return sum
    })()
    const pressure = this.buildScorePressure(input)

    return {
      round,
      maxRounds,
      handCards,
      unknownPool,
      difficulty,
      opponentCount,
      roundScore,
      futureScoreTotal,
      pressure,
      selectionRound: input.selectionRound !== false,
      isPublicCardHidden: input.isPublicCardHidden === true || !input.publicCard,
      fixedPublicCard: input.publicCard || null,
      remainingPublicCards,
    }
  }

  resolveStrategyMode(context = {}) {
    const scoreDelta = Number(context?.pressure?.scoreDelta || 0)
    const roundsLeft = Math.max(1, Number(context?.pressure?.roundsLeft || 1))
    const threshold = context.roundScore * roundsLeft * 0.55

    if (scoreDelta >= threshold) {
      return 'conservative'
    }
    if (scoreDelta <= -threshold) {
      return 'aggressive'
    }
    return 'balanced'
  }

  getBestThreeHandScore(cards = []) {
    if (!Array.isArray(cards) || cards.length < 3) {
      return 0
    }
    if (cards.length === 3) {
      return getHandScore(evaluateHand(cards))
    }

    let bestScore = 0
    for (let left = 0; left < cards.length - 2; left += 1) {
      for (let middle = left + 1; middle < cards.length - 1; middle += 1) {
        for (let right = middle + 1; right < cards.length; right += 1) {
          const currentScore = getHandScore(evaluateHand([
            cards[left],
            cards[middle],
            cards[right],
          ]))
          if (currentScore > bestScore) {
            bestScore = currentScore
          }
        }
      }
    }

    return bestScore
  }

  getBestPairWithPublicScore(handCards = [], publicCard = null) {
    if (!publicCard || !Array.isArray(handCards) || handCards.length < 2) {
      return 0
    }

    let bestScore = 0
    const pairs = buildPairIndices(handCards)
    pairs.forEach(([leftIndex, rightIndex]) => {
      const currentScore = getHandScore(evaluateHand([
        handCards[leftIndex],
        handCards[rightIndex],
        publicCard,
      ]))
      if (currentScore > bestScore) {
        bestScore = currentScore
      }
    })

    return bestScore
  }

  getFutureReserveValue(pair, context) {
    const remainingHand = removePairFromCards(context.handCards, pair)
    if (remainingHand.length === 0 || context.futureScoreTotal <= 0) {
      return 0
    }

    const bestThreeScore = this.getBestThreeHandScore(remainingHand)
    const bestFuturePublicScore = context.remainingPublicCards.reduce((best, publicCard) => {
      const currentScore = this.getBestPairWithPublicScore(remainingHand, publicCard)
      return Math.max(best, currentScore)
    }, 0)
    const reserveScore = Math.max(bestThreeScore, bestFuturePublicScore)
    if (!Number.isFinite(reserveScore) || reserveScore <= 0) {
      return 0
    }

    let reserveValue = (reserveScore / 1_000_000) * (context.futureScoreTotal / 10)
    if (context.round === context.maxRounds - 1) {
      reserveValue *= 1.35
    }
    return reserveValue
  }

  evaluateRoundResult({ ownEvaluation, opponentEvaluations, opponentCount, roundScore, difficulty, pressure }) {
    const participants = [
      { id: 'self', evaluation: ownEvaluation },
      ...opponentEvaluations.map((evaluation, index) => ({
        id: `opponent-${index + 1}`,
        evaluation,
      })),
    ]

    participants.sort((left, right) => compareHands(right.evaluation, left.evaluation))
    const rank = participants.findIndex((item) => item.id === 'self') + 1

    const losePenaltyBase = DIFFICULTY_LOSE_MULTIPLIER[difficulty] || 1
    const winBonus = DIFFICULTY_WIN_MULTIPLIER[difficulty] || 1
    const pressureShift = clamp(
      (pressure.scoreDelta / Math.max(1, pressure.roundsLeft * roundScore)) * 0.3,
      -0.25,
      0.25,
    )
    const losePenalty = losePenaltyBase + pressureShift
    const winReward = Math.max(0.8, winBonus - pressureShift)

    const loserRank = opponentCount >= 2 ? 2 : 2
    if (rank === 1) {
      return { utility: roundScore * winReward, rank }
    }
    if (rank === loserRank) {
      return { utility: -roundScore * losePenalty, rank }
    }

    return { utility: 0, rank }
  }

  simulateCandidate(pair, context, simulations) {
    if (context.selectionRound !== true) {
      return null
    }

    const [leftIndex, rightIndex] = pair
    const leftCard = context.handCards[leftIndex]
    const rightCard = context.handCards[rightIndex]
    if (!leftCard || !rightCard) {
      return null
    }

    let utilitySum = 0
    let winCount = 0
    let loseCount = 0
    let thirdCount = 0
    let handScoreSum = 0

    for (let index = 0; index < simulations; index += 1) {
      const publicCard = context.isPublicCardHidden
        ? context.unknownPool[this.randomIndex(context.unknownPool.length)]
        : context.fixedPublicCard
      if (!publicCard) {
        continue
      }

      const opponentPool = context.isPublicCardHidden
        ? context.unknownPool.filter((item) => getCardKey(item) !== getCardKey(publicCard))
        : context.unknownPool
      if (opponentPool.length < context.opponentCount * 2) {
        continue
      }

      const ownEvaluation = evaluateHand([leftCard, rightCard, publicCard])
      handScoreSum += getHandScore(ownEvaluation)

      const sampledIndices = this.pickDistinctIndices(
        opponentPool.length,
        context.opponentCount * 2,
      )
      if (sampledIndices.length < context.opponentCount * 2) {
        continue
      }

      const opponentEvaluations = []
      for (let cursor = 0; cursor < sampledIndices.length; cursor += 2) {
        const cardA = opponentPool[sampledIndices[cursor]]
        const cardB = opponentPool[sampledIndices[cursor + 1]]
        opponentEvaluations.push(evaluateHand([cardA, cardB, publicCard]))
      }

      const roundOutcome = this.evaluateRoundResult({
        ownEvaluation,
        opponentEvaluations,
        opponentCount: context.opponentCount,
        roundScore: context.roundScore,
        difficulty: context.difficulty,
        pressure: context.pressure,
      })
      utilitySum += roundOutcome.utility
      if (roundOutcome.rank === 1) {
        winCount += 1
      } else if (roundOutcome.rank === 2) {
        loseCount += 1
      } else if (roundOutcome.rank === 3) {
        thirdCount += 1
      }
    }

    if (simulations <= 0) {
      return null
    }

    const expectedUtility = utilitySum / simulations
    const winRate = winCount / simulations
    const loseRate = loseCount / simulations
    const thirdRate = thirdCount / simulations
    const averageHandScore = handScoreSum / simulations
    const reserveValue = this.getFutureReserveValue(pair, context)

    const strategicScore = expectedUtility
      + (winRate * (DIFFICULTY_WIN_WEIGHT[context.difficulty] || 0.2))
      + (thirdRate * (DIFFICULTY_THIRD_WEIGHT[context.difficulty] || 0.24))
      - (loseRate * (DIFFICULTY_RISK_WEIGHT[context.difficulty] || 0.16))
      + (reserveValue * (DIFFICULTY_RESERVE_WEIGHT[context.difficulty] || 0.3))
      + (averageHandScore / 10_000_000)

    return {
      pair,
      expectedUtility,
      winRate,
      loseRate,
      thirdRate,
      reserveValue,
      averageHandScore,
      strategicScore,
    }
  }

  getSimulationCount(candidateCount, difficulty) {
    const totalTarget = DIFFICULTY_TOTAL_SIMULATIONS[difficulty] || DIFFICULTY_TOTAL_SIMULATIONS.normal
    if (!Number.isInteger(candidateCount) || candidateCount <= 0) {
      return MIN_SIMULATIONS_PER_CANDIDATE
    }
    return clamp(
      Math.floor(totalTarget / candidateCount),
      MIN_SIMULATIONS_PER_CANDIDATE,
      MAX_SIMULATIONS_PER_CANDIDATE,
    )
  }

  pickFinalCandidate(sortedCandidates, difficulty) {
    if (!Array.isArray(sortedCandidates) || sortedCandidates.length === 0) {
      return null
    }

    if (this.disableExploration) {
      return sortedCandidates[0]
    }

    const exploreRate = DIFFICULTY_EXPLORATION_RATE[difficulty] || 0
    if (sortedCandidates.length <= 1 || this.random() >= exploreRate) {
      return sortedCandidates[0]
    }

    const maxPool = Math.min(
      sortedCandidates.length,
      DIFFICULTY_EXPLORATION_POOL[difficulty] || 2,
    )
    return sortedCandidates[this.randomIndex(maxPool)]
  }

  pickByMode(candidates, mode) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null
    }

    if (mode === 'aggressive') {
      return [...candidates].sort((left, right) => {
        if (left.loseRate !== right.loseRate) {
          return left.loseRate - right.loseRate
        }
        if (left.winRate !== right.winRate) {
          return right.winRate - left.winRate
        }
        if (left.reserveValue !== right.reserveValue) {
          return right.reserveValue - left.reserveValue
        }
        return right.averageHandScore - left.averageHandScore
      })[0]
    }

    if (mode === 'conservative') {
      return [...candidates].sort((left, right) => {
        if (left.loseRate !== right.loseRate) {
          return left.loseRate - right.loseRate
        }
        if (left.thirdRate !== right.thirdRate) {
          return right.thirdRate - left.thirdRate
        }
        if (left.reserveValue !== right.reserveValue) {
          return right.reserveValue - left.reserveValue
        }
        return left.averageHandScore - right.averageHandScore
      })[0]
    }

    return [...candidates].sort((left, right) => {
      if (left.loseRate !== right.loseRate) {
        return left.loseRate - right.loseRate
      }
      if (left.strategicScore !== right.strategicScore) {
        return right.strategicScore - left.strategicScore
      }
      return right.averageHandScore - left.averageHandScore
    })[0]
  }

  decideSelection(input = {}) {
    const context = this.createCandidateContext(input)
    if (context.selectionRound !== true) {
      return { selectedCards: [] }
    }
    if (context.handCards.length < 2) {
      return { selectedCards: [] }
    }

    const candidates = buildPairIndices(context.handCards)
    if (candidates.length === 0) {
      return { selectedCards: [] }
    }

    const simulations = this.getSimulationCount(candidates.length, context.difficulty)
    const scored = candidates
      .map((pair) => this.simulateCandidate(pair, context, simulations))
      .filter(Boolean)
      .sort((left, right) => {
        if (left.strategicScore !== right.strategicScore) {
          return right.strategicScore - left.strategicScore
        }
        if (left.expectedUtility !== right.expectedUtility) {
          return right.expectedUtility - left.expectedUtility
        }
        return right.averageHandScore - left.averageHandScore
      })

    if (scored.length === 0) {
      return { selectedCards: [] }
    }

    const mode = this.resolveStrategyMode(context)
    const baseSelected = this.pickByMode(scored, mode) || scored[0]
    const selected = this.pickFinalCandidate(scored, context.difficulty) || baseSelected
    const finalSelected = mode === 'balanced'
      ? selected
      : (scored.find((item) => isSamePair(item.pair, baseSelected.pair)) || baseSelected)
    if (!selected) {
      return { selectedCards: [] }
    }

    return {
      selectedCards: [...finalSelected.pair].sort((left, right) => left - right),
      meta: {
        difficulty: context.difficulty,
        mode,
        simulations,
        expectedUtility: finalSelected.expectedUtility,
        winRate: finalSelected.winRate,
        loseRate: finalSelected.loseRate,
        thirdRate: finalSelected.thirdRate,
        strategyScore: finalSelected.strategicScore,
      },
    }
  }
}

module.exports = { ZhaJinHuaStrategyEngine }

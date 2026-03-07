const { RuleDecisionProvider } = require('./providers/ruleDecisionProvider')
const { FallbackDecisionProvider } = require('./providers/fallbackDecisionProvider')

const DEFAULT_DECISION_TIMEOUT_MS = 120

function normalizeTimeout(timeoutMs, fallback = DEFAULT_DECISION_TIMEOUT_MS) {
  const normalized = Math.floor(Number(timeoutMs))
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback
  }
  return normalized
}

class BotDecisionService {
  constructor({
    primaryProvider = new RuleDecisionProvider(),
    fallbackProvider = new FallbackDecisionProvider(),
    decisionTimeoutMs = DEFAULT_DECISION_TIMEOUT_MS,
    llmConfig = null,
  } = {}) {
    this.primaryProvider = primaryProvider
    this.fallbackProvider = fallbackProvider
    this.decisionTimeoutMs = normalizeTimeout(decisionTimeoutMs, DEFAULT_DECISION_TIMEOUT_MS)
    this.llmConfig = llmConfig && typeof llmConfig === 'object'
      ? { ...llmConfig }
      : null
  }

  normalizeSelectedCards(selectedCards, handCardsLength) {
    if (!Array.isArray(selectedCards)) {
      return []
    }

    const deduplicated = Array.from(new Set(selectedCards)).sort((left, right) => left - right)
    if (deduplicated.length !== 2) {
      return []
    }

    const isValid = deduplicated.every((cardIndex) => (
      Number.isInteger(cardIndex) && cardIndex >= 0 && cardIndex < handCardsLength
    ))
    if (!isValid) {
      return []
    }

    return deduplicated
  }

  parseProviderResult(result) {
    if (Array.isArray(result)) {
      return result
    }
    if (result && Array.isArray(result.selectedCards)) {
      return result.selectedCards
    }
    return []
  }

  runWithTimeout(task, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false

      const timer = setTimeout(() => {
        if (settled) {
          return
        }

        settled = true
        reject(new Error('bot_decision_timeout'))
      }, timeoutMs)
      if (typeof timer.unref === 'function') {
        timer.unref()
      }

      Promise.resolve()
        .then(task)
        .then((value) => {
          if (settled) {
            return
          }
          settled = true
          clearTimeout(timer)
          resolve(value)
        })
        .catch((error) => {
          if (settled) {
            return
          }
          settled = true
          clearTimeout(timer)
          reject(error)
        })
    })
  }

  async decideSelection(input = {}, { timeoutMs } = {}) {
    const player = input?.player || {}
    const handCardsLength = Array.isArray(player.handCards) ? player.handCards.length : 0
    if (handCardsLength < 2) {
      return {
        selectedCards: [],
        provider: this.fallbackProvider?.name || 'fallback',
        latencyMs: 0,
        fallback: true,
        reason: 'insufficient_cards',
      }
    }

    const budgetMs = normalizeTimeout(timeoutMs, this.decisionTimeoutMs)
    const startedAt = Date.now()
    let primaryError = null

    try {
      const primaryResult = await this.runWithTimeout(
        () => this.primaryProvider.decide(input),
        budgetMs,
      )
      const normalizedSelection = this.normalizeSelectedCards(
        this.parseProviderResult(primaryResult),
        handCardsLength,
      )
      if (normalizedSelection.length === 2) {
        return {
          selectedCards: normalizedSelection,
          provider: this.primaryProvider?.name || 'primary',
          latencyMs: Date.now() - startedAt,
          fallback: false,
          reason: null,
        }
      }
      primaryError = new Error('bot_decision_invalid')
    } catch (error) {
      primaryError = error
    }

    const fallbackResult = await this.fallbackProvider.decide(input)
    const fallbackSelection = this.normalizeSelectedCards(
      this.parseProviderResult(fallbackResult),
      handCardsLength,
    )

    return {
      selectedCards: fallbackSelection.length === 2 ? fallbackSelection : [0, 1],
      provider: this.fallbackProvider?.name || 'fallback',
      latencyMs: Date.now() - startedAt,
      fallback: true,
      reason: primaryError?.message || 'fallback',
    }
  }
}

module.exports = { BotDecisionService }

class FallbackDecisionProvider {
  constructor() {
    this.name = 'fallback'
  }

  async decide({ player } = {}) {
    if (!Array.isArray(player?.handCards) || player.handCards.length < 2) {
      return { selectedCards: [] }
    }

    return { selectedCards: [0, 1] }
  }
}

module.exports = { FallbackDecisionProvider }

const { ZhaJinHuaStrategyEngine } = require('../engines/zhaJinHuaStrategyEngine')

class RuleDecisionProvider {
  constructor(options = {}) {
    this.name = 'rule'
    this.engine = options.engine || new ZhaJinHuaStrategyEngine({
      random: options.random,
      disableExploration: options.disableExploration,
    })
  }

  async decide(input = {}) {
    return this.engine.decideSelection(input)
  }
}

module.exports = { RuleDecisionProvider }

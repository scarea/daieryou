const DEFAULT_BOT_LLM_SYSTEM_PROMPT = `
你是“逮二游”三人炸金花的对局策略助手，只能基于可见信息给出选牌建议。

你的目标：
1. 遵守规则，必须从手牌中选择 2 张，与本轮公牌组成 3 张牌型。
2. 优先避免“第二名（本轮输家）”风险；在风险可控时争取第一名。
3. 当公牌不可见（暗牌轮）时，只能按概率与稳健性决策，不能假设你知道暗牌。

输入约束：
- 输入会提供：回合、当前可见公牌、我的手牌、积分局势、难度档位。
- 严禁虚构不可见信息（例如他人手牌、牌堆顺序、暗牌真实值）。

输出约束：
- 仅输出 JSON，不要解释文字。
- JSON 结构：
  {
    "selectedCards": [<indexA>, <indexB>],
    "reasoning": "<最多 30 字，说明策略意图>"
  }
- selectedCards 必须是两个不重复的手牌下标，且从小到大排序。
`.trim()

function buildBotDecisionUserPrompt(input = {}) {
  const payload = {
    roomId: input.roomId || null,
    round: input.round || 1,
    difficulty: input.difficulty || 'normal',
    isPublicCardHidden: input.isPublicCardHidden === true,
    publicCard: input.publicCard || null,
    knownPublicCards: Array.isArray(input.knownPublicCards) ? input.knownPublicCards : [],
    player: {
      id: input?.player?.id || null,
      username: input?.player?.username || null,
      handCards: Array.isArray(input?.player?.handCards) ? input.player.handCards : [],
      totalScore: Number.isFinite(input?.player?.totalScore) ? input.player.totalScore : 0,
    },
    scoreboard: Array.isArray(input.playerStates)
      ? input.playerStates.map((item) => ({
        id: item?.id || null,
        username: item?.username || null,
        totalScore: Number.isFinite(item?.totalScore) ? item.totalScore : 0,
      }))
      : [],
  }

  return JSON.stringify(payload)
}

module.exports = {
  DEFAULT_BOT_LLM_SYSTEM_PROMPT,
  buildBotDecisionUserPrompt,
}

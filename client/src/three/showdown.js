// 回合结算演出的时间轴（毫秒）。3D 动画与音效都按这一份时间表执行，保证声画同步。
//
// 节奏：灯光压暗 → 末位/头名依次翻牌 → 停顿 → 二游最后翻开 → 盖章 → 筹码飞向赢家 → 分数飘字 → 结果条

const BIG_HAND_TYPES = new Set(['leopard', 'straight_flush'])

function getLoserIndexes(result) {
  if (Array.isArray(result?.loserIndexes)) {
    return result.loserIndexes
  }
  return result?.loserIndex >= 0 ? [result.loserIndex] : []
}

export function buildShowdownTimeline(result, { reducedMotion = false, isFinal = false } = {}) {
  if (!result || !Array.isArray(result.playerResults)) {
    return null
  }

  const loserIndexes = getLoserIndexes(result)
  const scale = reducedMotion ? 0.35 : 1
  const perPlayer = (isFinal ? 900 : 620) * scale
  const perCard = (isFinal ? 260 : 150) * scale
  const intro = (isFinal ? 1700 : 380) * scale
  const suspense = (isFinal ? 700 : 420) * scale

  // 悬念排序：赢家（末位优先，再头名）先翻，二游最后翻
  const ordered = [...result.playerResults].sort((left, right) => {
    const leftLoser = loserIndexes.includes(left.playerIndex) ? 1 : 0
    const rightLoser = loserIndexes.includes(right.playerIndex) ? 1 : 0
    if (leftLoser !== rightLoser) {
      return leftLoser - rightLoser
    }
    return right.rank - left.rank
  })

  let cursor = intro
  const players = ordered.map((playerResult, order) => {
    const isLoser = loserIndexes.includes(playerResult.playerIndex)
    if (isLoser && order > 0 && !loserIndexes.includes(ordered[order - 1].playerIndex)) {
      cursor += suspense
    }
    const cardCount = Array.isArray(playerResult.hand) ? playerResult.hand.length : 3
    const flips = Array.from({ length: cardCount }, (_, cardIndex) => cursor + cardIndex * perCard)
    const entry = {
      playerId: playerResult.playerId,
      playerIndex: playerResult.playerIndex,
      order,
      isLoser,
      rank: playerResult.rank,
      scoreDelta: Number(playerResult.scoreDelta || 0),
      handType: playerResult.evaluation?.type,
      isBigHand: BIG_HAND_TYPES.has(playerResult.evaluation?.type),
      flips,
      revealedAt: flips[flips.length - 1] + 220 * scale,
    }
    cursor += perPlayer
    return entry
  })

  const lastReveal = Math.max(...players.map((player) => player.revealedAt))
  const stampAt = loserIndexes.length > 0 ? lastReveal + 260 * scale : null
  const chipsAt = (stampAt ?? lastReveal) + 380 * scale
  const chipsDuration = 900 * scale
  const numbersAt = chipsAt + 200 * scale
  const outcomeAt = chipsAt + 350 * scale
  const endAt = chipsAt + chipsDuration + (isFinal ? 900 : 450) * scale

  // 每笔转账：二游 → 各赢家
  const transfers = []
  players.filter((player) => player.isLoser).forEach((loser) => {
    players.filter((player) => !player.isLoser && player.scoreDelta > 0).forEach((winner) => {
      const share = Math.max(1, Math.round(winner.scoreDelta / Math.max(1, players.filter((item) => item.isLoser).length)))
      transfers.push({ fromId: loser.playerId, toId: winner.playerId, amount: share })
    })
  })

  return {
    round: result.round,
    isFinal,
    players,
    stampAt,
    chipsAt,
    chipsDuration,
    numbersAt,
    outcomeAt,
    endAt,
    transfers,
    bigHands: players.filter((player) => player.isBigHand).map((player) => ({ playerId: player.playerId, at: player.revealedAt, type: player.handType })),
    doubled: result.playerResults.some((item) => Number(item.scoreDelta) < -2 * Number(result.score || 0)),
  }
}

export function getShowdownKey(result) {
  if (!result) {
    return null
  }
  return `${result.round}:${(result.playerResults || []).map((item) => `${item.playerId}${item.scoreDelta}`).join('|')}`
}

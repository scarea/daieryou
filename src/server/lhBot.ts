// 六胡抢机器人：四档难度。
// 摸牌不入手，手牌只减不增，所以关键是：留住能成门子的搭子、吃碰要有取舍、别放炮（放炮一人赔三份）。
import { LhAction, LhPlayer, LhState, choicesFor, lhVisible } from '../shared/liuhu/game.ts'
import { GROUP, HU, chiCost, handValue } from '../shared/liuhu/eval.ts'
import { groupHu } from '../shared/liuhu/hand.ts'
import { lhCounts, lhKind } from '../shared/liuhu/tiles.ts'
import type { LhLevel } from '../shared/liuhu/view.ts'

/** 打这张牌有多危险：没人打过、场上见得少的"生牌"最容易放炮 */
function danger(state: LhState, seat: number, kind: number, level: LhLevel): number {
  if (level === 'easy' || level === 'normal') return 0
  const piles = state.players.reduce((sum, player) => sum + player.discards.filter((tile) => lhKind(tile) === kind).length, 0)
  if (piles > 0) return 0
  const seen = lhVisible(state, seat)[kind]
  let risk = 2.2 - seen * 0.4
  if (level === 'master') {
    // 别家亮出的门子越多越接近胡牌
    const hot = Math.max(...state.players.filter((_, index) => index !== seat).map((player) => player.melds.length))
    risk *= 1 + hot * 0.45
  }
  return Math.max(0, risk)
}

function bestDiscard(state: LhState, seat: number, player: LhPlayer, tiles: number[], level: LhLevel, random: () => number): { tile: number; value: number } {
  const counts = lhCounts(player.hand)
  let best = { tile: tiles[0], value: -Infinity }
  for (const kind of new Set(tiles.map(lhKind))) {
    counts[kind] -= 1
    const noise = level === 'normal' ? random() * 3 : random() * 0.2
    const value = handValue(counts) - danger(state, seat, kind, level) + noise
    counts[kind] += 1
    if (value > best.value) best = { tile: tiles.find((tile) => lhKind(tile) === kind) as number, value }
  }
  return best
}

/** 吃 / 碰之后（再打掉一张最没用的）手牌的价值 */
function afterTake(state: LhState, seat: number, removed: number[], gained: number, level: LhLevel, random: () => number): number {
  const player = state.players[seat]
  const hand = [...player.hand]
  for (const kind of removed) hand.splice(hand.findIndex((tile) => lhKind(tile) === kind), 1)
  const shadow: LhPlayer = { ...player, hand }
  const free = hand.filter((tile) => hand.filter((other) => lhKind(other) === lhKind(tile)).length < 3)
  const tiles = free.length > 0 ? free : hand
  if (tiles.length === 0) return gained
  return gained + bestDiscard(state, seat, shadow, tiles, level, random).value
}

export function lhBotAction(state: LhState, seat: number, level: LhLevel, random: () => number = Math.random): LhAction {
  const choices = choicesFor(state, seat)
  const player = state.players[seat]
  if (choices.hu) return { type: 'hu' }
  if (choices.discards.length > 0) {
    if (level === 'easy' && random() < 0.5) return { type: 'discard', tile: choices.discards[Math.floor(random() * choices.discards.length)] }
    return { type: 'discard', tile: bestDiscard(state, seat, player, choices.discards, level, random).tile }
  }
  const pending = state.pending
  if (!pending) return { type: 'pass' }
  const kind = lhKind(pending.tile)
  const now = handValue(lhCounts(player.hand))
  // 已经亮出的胡数够不够起胡：不够时更看重带胡数的门子
  const shownHu = player.melds.reduce((sum, meld) => sum + meld.hu, 0)
  const margin = level === 'easy' ? -99 : 1

  if (choices.peng) {
    const hu = groupHu('peng', [kind])
    // 小碰是白碰：高手只在门子快齐了的时候才碰
    if (level === 'master' && hu === 0 && player.melds.length === 0 && player.hand.length > 12 && random() < 0.5) return { type: 'pass' }
    const after = afterTake(state, seat, [kind, kind], GROUP + hu * HU + (shownHu < 6 ? hu : 0), level, random)
    return after - now >= margin ? { type: 'peng' } : { type: 'pass' }
  }
  if (choices.chi.length > 0) {
    let best = { index: -1, value: -Infinity }
    choices.chi.forEach((option, index) => {
      const { removed, gained } = chiCost(option, kind)
      const value = afterTake(state, seat, removed, gained, level, random)
      if (value > best.value) best = { index, value }
    })
    if (best.index >= 0 && best.value - now >= margin) return { type: 'chi', option: best.index }
  }
  return { type: 'pass' }
}

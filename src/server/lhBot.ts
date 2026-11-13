// 六胡抢机器人：四档难度。
// 摸牌不入手，手牌只减不增，所以关键是：留住能成门子的搭子、吃碰要有取舍、别放炮（放炮一人赔三份）。
import { LhAction, LhPlayer, LhState, choicesFor, lhVisible } from '../shared/liuhu/game.ts'
import { ChiOption, chiGroup, groupHu } from '../shared/liuhu/hand.ts'
import { LH_KINDS, lhCounts, lhIsBig, lhKind, lhRank, lhTwin } from '../shared/liuhu/tiles.ts'
import type { LhLevel } from '../shared/liuhu/view.ts'

const GROUP = 10
const HU = 1.3

/** 一手散牌的价值：成型的门子、差一张的搭子、对子，以及它们带的胡数 */
function handValue(counts: number[]): number {
  const cache = new Map<string, number>()
  const locked = counts.map((count) => count >= 3)
  const search = (): number => {
    let kind = 0
    while (kind < LH_KINDS && counts[kind] === 0) kind += 1
    if (kind === LH_KINDS) return 0
    const key = counts.join('')
    const known = cache.get(key)
    if (known !== undefined) return known
    const base = lhIsBig(kind) ? 10 : 0
    const rank = lhRank(kind)
    const at = (r: number) => (r >= 1 && r <= 10 && !locked[base + r - 1] ? counts[base + r - 1] : 0)
    let best = 0
    const use = (kinds: number[], value: number) => {
      for (const item of kinds) counts[item] -= 1
      best = Math.max(best, value + search())
      for (const item of kinds) counts[item] += 1
    }
    if (locked[kind]) {
      // 坎 / 提：整门拿走
      const size = counts[kind]
      counts[kind] = 0
      best = GROUP + groupHu(size === 4 ? 'ti' : 'kan', [kind]) * HU + search()
      counts[kind] = size
      cache.set(key, best)
      return best
    }
    // 单张留着
    use([kind], 0)
    // 顺子与差一张的顺子搭子
    if (at(rank + 1) && at(rank + 2)) use([kind, kind + 1, kind + 2], GROUP + (rank === 1 ? groupHu('seq', [kind, kind + 1, kind + 2]) : 0) * HU)
    if (at(rank + 1)) use([kind, kind + 1], rank === 1 || rank === 2 ? 4.5 : 4)
    if (at(rank + 2)) use([kind, kind + 2], 3)
    // 二七十
    if (rank === 2 && at(7) && at(10)) use([kind, base + 6, base + 9], GROUP + groupHu('ershi', [kind]) * HU)
    if (rank === 2 && at(7)) use([kind, base + 6], 3.5)
    if (rank === 2 && at(10)) use([kind, base + 9], 3.5)
    if (rank === 7 && at(10)) use([kind, base + 9], 3.5)
    // 对子：能碰、能笑、能做将
    if (counts[kind] >= 2) use([kind, kind], 5.5 + (lhIsBig(kind) ? 1 : 0))
    // 搭
    const twin = lhTwin(kind)
    if (twin > kind && !locked[twin] && counts[twin] > 0) {
      if (counts[kind] >= 2) use([kind, kind, twin], GROUP)
      if (counts[twin] >= 2) use([kind, twin, twin], GROUP)
      use([kind, twin], 3)
    }
    cache.set(key, best)
    return best
  }
  return search()
}

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

function chiValue(option: ChiOption, tileKind: number): { removed: number[]; gained: number } {
  const removed: number[] = []
  let gained = 0
  option.groups.forEach((kinds, index) => {
    const need = [...kinds]
    if (index === 0) need.splice(need.indexOf(tileKind), 1)
    removed.push(...need)
    gained += GROUP + chiGroup(kinds).hu * HU
  })
  return { removed, gained }
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
      const { removed, gained } = chiValue(option, kind)
      const value = afterTake(state, seat, removed, gained, level, random)
      if (value > best.value) best = { index, value }
    })
    if (best.index >= 0 && best.value - now >= margin) return { type: 'chi', option: best.index }
  }
  return { type: 'pass' }
}

// 红中麻将机器人：四档难度。
// 这套规则只能自摸、没有点炮，所以不存在"防守"——打得好就是牌效高（进张多、成牌快），
// 再加上碰杠的取舍。难度差别就体现在算得多准、算得多远。
import { DiscardOption, analyzeDiscards, shanten } from '../shared/mahjong/hand.ts'
import { MjAction, MjState, choicesFor, remainingFor, visibleCounts } from '../shared/mahjong/game.ts'
import { ZHONG, countKinds, kindOf, rankOf } from '../shared/mahjong/tiles.ts'
import type { MjLevel } from '../shared/mahjong/view.ts'

const pick = <T>(items: T[], random: () => number): T => items[Math.floor(random() * items.length)]

/** 牌的"灵活度"：中张（3~7）最容易靠成顺子，幺九最死 */
function flexibility(kind: number): number {
  const rank = rankOf(kind)
  return rank >= 3 && rank <= 7 ? 2 : rank === 2 || rank === 8 ? 1 : 0
}

/** 入门：只看牌面，打孤张，优先打幺九 */
function naiveDiscard(counts: number[], kinds: number[], random: () => number): number {
  let worst: number[] = []
  let worstValue = Infinity
  for (const kind of kinds) {
    const rank = rankOf(kind)
    const near = (offset: number) => {
      const target = rank + offset
      return target >= 1 && target <= 9 ? counts[kind + offset] : 0
    }
    // 成对、有邻牌的更值得留
    const value = counts[kind] * 3 + (near(-1) + near(1)) * 2 + near(-2) + near(2) + flexibility(kind) * 0.5 + random()
    if (value < worstValue - 1e-9) {
      worstValue = value
      worst = [kind]
    }
  }
  return worst[0]
}

/** 大师：对几个最优候选多看一步——摸到有效牌之后，下一步还剩多少进张 */
function lookahead(counts: number[], melds: number, remaining: number[], option: DiscardOption, state: MjState): number {
  counts[option.kind] -= 1
  const draws = [...option.accepts].sort((a, b) => remaining[b] - remaining[a]).slice(0, 5)
  let weighted = 0
  let weight = 0
  for (const draw of draws) {
    counts[draw] += 1
    remaining[draw] -= 1
    const next = analyzeDiscards(counts, melds, remaining, state.options)[0]
    // 已经胡了算满分；否则看下一步的进张
    weighted += (next.shanten < 0 ? 40 : next.ukeire) * (remaining[draw] + 1)
    weight += remaining[draw] + 1
    remaining[draw] += 1
    counts[draw] -= 1
  }
  counts[option.kind] += 1
  return weight > 0 ? weighted / weight : 0
}

function chooseDiscard(state: MjState, seat: number, level: MjLevel, random: () => number): number {
  const player = state.players[seat]
  const choices = choicesFor(state, seat)
  const counts = countKinds(player.hand)
  // 红中是万能牌，除非手里只剩红中，否则不打
  const nonZhong = choices.discards.filter((tile) => kindOf(tile) !== ZHONG)
  const tiles = nonZhong.length > 0 ? nonZhong : choices.discards
  const kinds = [...new Set(tiles.map(kindOf))]
  const tileOf = (kind: number) => tiles.find((tile) => kindOf(tile) === kind) as number

  if (level === 'easy') return tileOf(naiveDiscard(counts, kinds, random))

  const remaining = remainingFor(state, seat)
  const options = analyzeDiscards(counts, player.melds.length, remaining, state.options).filter((option) => kinds.includes(option.kind))
  if (options.length === 0) return tiles[0]
  const best = options[0]
  const same = options.filter((option) => option.shanten === best.shanten)

  if (level === 'normal') {
    // 进阶：向听数算得对，但进张不精确；偶尔手滑
    if (random() < 0.18 && options.length > 1) return tileOf(pick(options.slice(0, Math.min(4, options.length)), random).kind)
    return tileOf(pick(same.slice(0, Math.min(3, same.length)), random).kind)
  }

  // 高手 / 大师：进张最多；进张相同打更死的牌（幺九优先），并倾向打场上已经见过的牌
  const seen = visibleCounts(state, seat)
  const tieBreak = (option: DiscardOption) => -flexibility(option.kind) + (seen[option.kind] - counts[option.kind]) * 0.3
  let candidates = same.filter((option) => option.ukeire >= best.ukeire - (level === 'master' ? 2 : 0))
  if (level === 'master' && candidates.length > 1 && best.shanten > 0) {
    const scored = candidates.slice(0, 3).map((option) => ({ option, value: option.ukeire * 2 + lookahead(counts, player.melds.length, remaining, option, state) }))
    scored.sort((a, b) => b.value - a.value || tieBreak(b.option) - tieBreak(a.option))
    return tileOf(scored[0].option.kind)
  }
  candidates = candidates.filter((option) => option.ukeire === candidates[0].ukeire)
  candidates.sort((a, b) => tieBreak(b) - tieBreak(a))
  return tileOf(candidates[0].kind)
}

/** 碰 / 杠之后手牌离胡牌是否更近 */
function claimHelps(state: MjState, seat: number, take: number): { before: number; after: number } {
  const player = state.players[seat]
  const kind = kindOf(state.lastDiscard!.tile)
  const counts = countKinds(player.hand)
  const before = shanten(counts, player.melds.length, state.options)
  counts[kind] -= take
  let after: number
  if (take === 3) {
    // 杠：补一张牌再打，手牌张数不变
    after = shanten(counts, player.melds.length + 1, state.options)
  } else {
    // 碰：之后要打出一张，取最好的打法
    after = 99
    for (let discard = 0; discard < counts.length; discard += 1) {
      if (counts[discard] === 0) continue
      counts[discard] -= 1
      after = Math.min(after, shanten(counts, player.melds.length + 1, state.options))
      counts[discard] += 1
    }
  }
  return { before, after }
}

export function botAction(state: MjState, seat: number, level: MjLevel, random: () => number = Math.random): MjAction {
  const choices = choicesFor(state, seat)

  if (state.phase === 'claim') {
    if (level === 'easy') return choices.kong ? { type: 'kong' } : random() < 0.7 ? { type: 'pung' } : { type: 'pass' }
    if (choices.kong) {
      // 放杠白拿 3 分还多摸一张：只要不拖慢手牌就杠
      const { before, after } = claimHelps(state, seat, 3)
      if (after <= before) return { type: 'kong' }
    }
    if (choices.pung) {
      const { before, after } = claimHelps(state, seat, 2)
      if (after < before) return { type: 'pung' }
      // 进阶偶尔会多碰；高手和大师不碰没用的牌
      if (level === 'normal' && after === before && random() < 0.3) return { type: 'pung' }
    }
    return { type: 'pass' }
  }

  if (choices.hu) return { type: 'hu' }
  const player = state.players[seat]
  if (choices.ankan.length > 0 || choices.bukan.length > 0) {
    const counts = countKinds(player.hand)
    const now = analyzeDiscards(counts, player.melds.length, remainingFor(state, seat), state.options)[0]?.shanten ?? 9
    for (const kind of choices.ankan) {
      counts[kind] -= 4
      const after = shanten(counts, player.melds.length + 1, state.options)
      counts[kind] += 4
      if (level === 'easy' || after <= now) return { type: 'ankan', kind }
    }
    for (const kind of choices.bukan) {
      counts[kind] -= 1
      const after = shanten(counts, player.melds.length, state.options)
      counts[kind] += 1
      if (level === 'easy' || after <= now) return { type: 'bukan', kind }
    }
  }
  return { type: 'discard', tile: chooseDiscard(state, seat, level, random) }
}

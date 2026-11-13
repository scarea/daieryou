// 复盘：用牌谱重放每一手，按牌效（向听数、进张数）评价玩家的每次出牌与碰杠取舍。
import { DiscardOption, analyzeDiscards, shanten } from '../../shared/mahjong/hand.ts'
import { MjEvent, choicesFor, remainingFor, replay } from '../../shared/mahjong/game.ts'
import { ZHONG, countKinds, kindOf, kindShort } from '../../shared/mahjong/tiles.ts'
import { MJ_LEVEL_NAME, MjRecord } from '../../shared/mahjong/view.ts'

export type Grade = 'best' | 'ok' | 'miss' | 'blunder'

export interface DiscardReview {
  /** 第几次出牌（1 起） */
  turn: number
  /** 出牌前的暗手牌（id） */
  hand: number[]
  melds: number
  chosen: DiscardOption
  best: DiscardOption
  /** 所有打法，按优劣排序 */
  options: DiscardOption[]
  grade: Grade
  /** 比最优打法少的进张数 */
  loss: number
  wallLeft: number
}

export interface ClaimReview {
  turn: number
  kind: number
  /** 玩家的选择 */
  action: 'pung' | 'kong' | 'pass'
  /** 碰 / 杠能否让手牌更近一步 */
  helps: boolean
  canKong: boolean
}

export interface Review {
  discards: DiscardReview[]
  claims: ClaimReview[]
  /** 出牌准确率：最优或可接受的占比 */
  accuracy: number
  totalLoss: number
  /** 第几手听牌；没听牌为 0 */
  tenpaiTurn: number
  kongs: number
}

export const GRADE_NAME: Record<Grade, string> = { best: '最优', ok: '可以', miss: '失误', blunder: '大错' }

export function reviewRecord(record: MjRecord, seat = 0): Review {
  const discards: DiscardReview[] = []
  const claims: ClaimReview[] = []
  let tenpaiTurn = 0
  let kongs = 0

  record.events.forEach((event: MjEvent, index) => {
    if (!('seat' in event) || event.seat !== seat) return
    if (event.t === 'kong' || event.t === 'ankan' || event.t === 'bukan') kongs += 1
    if (event.t !== 'discard' && event.t !== 'pung' && event.t !== 'kong' && event.t !== 'pass') return

    const state = replay(record.init, record.events, record.options, index)
    const player = state.players[seat]
    const counts = countKinds(player.hand)
    const meldCount = player.melds.length

    if (event.t === 'discard') {
      const options = analyzeDiscards(counts, meldCount, remainingFor(state, seat), record.options)
      const chosen = options.find((option) => option.kind === kindOf(event.tile)) as DiscardOption
      // 打红中几乎总是错的：最优解里排除"打红中"，除非手里只有红中
      const best = options.find((option) => option.kind !== ZHONG) ?? options[0]
      const loss = Math.max(0, best.ukeire - chosen.ukeire)
      let grade: Grade = 'best'
      if (chosen.shanten > best.shanten || (chosen.kind === ZHONG && best.kind !== ZHONG)) grade = 'blunder'
      else if (loss > Math.max(3, best.ukeire * 0.25)) grade = 'miss'
      else if (loss > 0) grade = 'ok'
      const turn = discards.length + 1
      if (!tenpaiTurn && chosen.shanten === 0) tenpaiTurn = turn
      discards.push({ turn, hand: [...player.hand], melds: meldCount, chosen, best, options, grade, loss, wallLeft: state.wall.length })
      return
    }

    // 碰 / 杠 / 过：比较动手前后的向听数
    const claim = state.lastDiscard
    if (!claim) return
    const kind = kindOf(claim.tile)
    const before = shanten(counts, meldCount, record.options)
    counts[kind] -= 2
    let after = 99
    for (let discard = 0; discard < counts.length; discard += 1) {
      if (counts[discard] === 0) continue
      counts[discard] -= 1
      after = Math.min(after, shanten(counts, meldCount + 1, record.options))
      counts[discard] += 1
    }
    counts[kind] += 2
    claims.push({
      turn: discards.length + 1,
      kind,
      action: event.t as ClaimReview['action'],
      helps: after < before,
      canKong: choicesFor(state, seat).kong,
    })
  })

  const good = discards.filter((item) => item.grade === 'best' || item.grade === 'ok').length
  return {
    discards,
    claims,
    accuracy: discards.length ? good / discards.length : 1,
    totalLoss: discards.reduce((sum, item) => sum + item.loss, 0),
    tenpaiTurn,
    kongs,
  }
}

const handText = (ids: number[]) => [...ids].sort((a, b) => a - b).map((id) => kindShort(kindOf(id))).join(' ')

/** 把复盘数据整理成给 AI 教练看的文字（只含程序算出的客观事实） */
export function reviewPrompt(record: MjRecord, review: Review, outcome: string): string {
  const lines: string[] = []
  lines.push(`对手难度：${MJ_LEVEL_NAME[record.level]}。本局结果：${outcome}。`)
  lines.push(`规则开关：七对${record.options.sevenPairs ? '算胡' : '不算胡'}；四红中${record.options.fourZhong ? '直接胡' : '不直接胡'}。`)
  lines.push(`出牌 ${review.discards.length} 手，准确率 ${Math.round(review.accuracy * 100)}%，累计少了 ${review.totalLoss} 张进张；${review.tenpaiTurn ? `第 ${review.tenpaiTurn} 手听牌` : '全局未听牌'}；杠了 ${review.kongs} 次。`)
  lines.push('')
  lines.push('逐手数据（向听数 0 = 已听牌；进张 = 能让手牌前进的牌还剩几张）：')
  for (const item of review.discards) {
    const tag = item.grade === 'best' ? '最优' : item.grade === 'ok' ? '略亏' : item.grade === 'miss' ? '失误' : '大错'
    const waiting = item.chosen.accepts.slice(0, 8).map(kindShort).join('、') || '无'
    let line = `第${item.turn}手 [${tag}] 手牌：${handText(item.hand)}${item.melds ? `（已碰杠 ${item.melds} 组）` : ''}；打 ${kindShort(item.chosen.kind)} → ${item.chosen.shanten} 向听，进张 ${item.chosen.ukeire}（等 ${waiting}）`
    if (item.grade !== 'best') {
      line += `；最优是打 ${kindShort(item.best.kind)} → ${item.best.shanten} 向听，进张 ${item.best.ukeire}（等 ${item.best.accepts.slice(0, 8).map(kindShort).join('、') || '无'}）`
    }
    lines.push(line)
  }
  if (review.claims.length) {
    lines.push('')
    lines.push('碰杠取舍：')
    for (const claim of review.claims) {
      const did = claim.action === 'pass' ? '选择了过' : claim.action === 'pung' ? '选择了碰' : '选择了杠'
      lines.push(`第${claim.turn}手前，别人打出 ${kindShort(claim.kind)}，可以碰${claim.canKong ? '或杠' : ''}，${did}；碰了${claim.helps ? '能' : '不能'}让手牌更近一步。`)
    }
  }
  return lines.join('\n').slice(0, 11000)
}

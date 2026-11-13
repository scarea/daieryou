// 六胡抢复盘：把我这一局的每一次决定过一遍，给出牌力对比，并整理成给 AI 教练的文字。
import { DiscardValue, GROUP, HU, chiCost, discardValues, takeGain } from '../../shared/liuhu/eval.ts'
import type { LhDecision, LhResult } from '../../shared/liuhu/game.ts'
import { TableMeld, groupHu } from '../../shared/liuhu/hand.ts'
import { lhKind, lhName, lhSort } from '../../shared/liuhu/tiles.ts'
import { LH_LEVEL_NAME, LhRecord } from '../../shared/liuhu/view.ts'

export type Grade = 'best' | 'ok' | 'miss' | 'blunder'
export const GRADE_NAME: Record<Grade, string> = { best: '最优', ok: '可以', miss: '失误', blunder: '大错' }

export interface DiscardReview {
  turn: number
  hand: number[]
  melds: number
  chosen: DiscardValue
  best: DiscardValue
  grade: Grade
  /** 打的是生牌 */
  fresh: boolean
  /** 这一张放了炮 */
  pao: boolean
}

export interface ClaimReview {
  turn: number
  tile: number
  source: string
  canHu: boolean
  canPeng: boolean
  canChi: boolean
  act: LhDecision['act']
  /** 吃 / 碰之后手牌变好了多少（正数 = 值得要） */
  gain: number
  grade: Grade
}

export interface LhReview {
  discards: DiscardReview[]
  claims: ClaimReview[]
  accuracy: number
  bad: number
  /** 第几手打完开始听牌；0 表示全局没听 */
  tenpaiTurn: number
  takes: number
  pao: boolean
}

const toMelds = (decision: LhDecision): TableMeld[] => decision.melds.map((meld) => ({ type: meld.type, kind: meld.kinds[0], tiles: meld.kinds.map((kind) => kind * 4), hu: meld.hu }))
const WHO = ['自己', '下家', '对家', '上家']

export function reviewLiuhu(record: LhRecord, result: LhResult | null): LhReview {
  const discards: DiscardReview[] = []
  const claims: ClaimReview[] = []
  let turn = 0
  let tenpaiTurn = 0
  let takes = 0
  const lastDiscard = [...record.decisions].reverse().find((item) => item.act === 'discard')
  for (const decision of record.decisions) {
    const melds = toMelds(decision)
    if (decision.act === 'discard') {
      turn += 1
      const free = decision.hand.filter((tile) => decision.hand.filter((other) => lhKind(other) === lhKind(tile)).length < 3)
      const options = discardValues(melds, decision.hand, free.length > 0 ? free : decision.hand)
      const chosen = options.find((option) => option.kind === lhKind(decision.out)) ?? options[options.length - 1]
      const best = options[0]
      const loss = best.value - chosen.value
      const pao = Boolean(result && result.kind === 'pao' && result.loser === 0 && decision === lastDiscard)
      let grade: Grade = loss <= 0.5 ? 'best' : loss <= 3 ? 'ok' : loss <= 8 ? 'miss' : 'blunder'
      if (pao && decision.fresh && grade === 'best') grade = 'ok'
      if (!tenpaiTurn && chosen.waits.length > 0) tenpaiTurn = turn
      discards.push({ turn, hand: decision.hand, melds: decision.melds.length, chosen, best, grade, fresh: decision.fresh, pao })
      continue
    }
    const kind = lhKind(decision.tile)
    let gain = 0
    if (decision.can.peng) gain = takeGain(melds, decision.hand, [kind, kind], GROUP + groupHu('peng', [kind]) * HU)
    if (decision.can.chi.length > 0) {
      const gains = decision.can.chi.map((groups) => {
        const { removed, gained } = chiCost({ groups }, kind)
        return takeGain(melds, decision.hand, removed, gained)
      })
      gain = decision.act === 'chi' ? gains[decision.out] ?? Math.max(...gains) : Math.max(...gains)
    }
    let grade: Grade = 'best'
    if (decision.can.hu) grade = decision.act === 'hu' ? 'best' : 'blunder'
    else if (decision.act === 'pass') grade = gain >= 6 ? 'miss' : gain >= 2 ? 'ok' : 'best'
    else grade = gain >= 1 ? 'best' : gain >= -3 ? 'ok' : 'miss'
    if (decision.act === 'peng' || decision.act === 'chi') takes += 1
    claims.push({
      turn: turn + 1, tile: decision.tile, source: `${WHO[decision.from] ?? ''}${decision.source === 'draw' ? '摸出' : decision.source === 'open' ? '的挡底' : '打出'}`,
      canHu: decision.can.hu, canPeng: decision.can.peng, canChi: decision.can.chi.length > 0, act: decision.act, gain, grade,
    })
  }
  const all = [...discards, ...claims]
  const good = all.filter((item) => item.grade === 'best' || item.grade === 'ok').length
  return {
    discards, claims, takes, tenpaiTurn,
    accuracy: all.length ? good / all.length : 1,
    bad: all.filter((item) => item.grade === 'miss' || item.grade === 'blunder').length,
    pao: discards.some((item) => item.pao),
  }
}

const names = (kinds: number[]) => kinds.map(lhName).join('、') || '无'
const ACT_NAME = { hu: '胡', peng: '碰', chi: '吃', pass: '过', discard: '打牌' }

/** 给 AI 教练的文字材料 */
export function lhReviewPrompt(record: LhRecord, review: LhReview, outcome: string): string {
  const lines: string[] = []
  lines.push(`游戏：常宁六胡抢。对手难度：${LH_LEVEL_NAME[record.level]}。本局结果：${outcome}。`)
  lines.push(`打牌 ${review.discards.length} 手，吃碰 ${review.takes} 次，判断准确率 ${Math.round(review.accuracy * 100)}%，失误 ${review.bad} 处；${review.tenpaiTurn ? `第 ${review.tenpaiTurn} 手打完开始听牌` : '全局没有听牌'}${review.pao ? '；最后放了炮' : ''}。`)
  lines.push('')
  lines.push('逐手打牌（听 = 打完之后在等哪些牌；牌力 = 程序估的手牌价值，越高越好）：')
  for (const item of review.discards) {
    let line = `第${item.turn}手 [${GRADE_NAME[item.grade]}] 手牌：${lhSort(item.hand).map((tile) => lhName(lhKind(tile))).join('')}${item.melds ? `（已亮 ${item.melds} 门）` : ''}；打 ${lhName(item.chosen.kind)}${item.fresh ? '（生牌）' : ''}${item.pao ? '【放炮】' : ''} → 听 ${names(item.chosen.waits)}，牌力 ${item.chosen.value.toFixed(0)}`
    if (item.best.kind !== item.chosen.kind && item.grade !== 'best') line += `；更好是打 ${lhName(item.best.kind)} → 听 ${names(item.best.waits)}，牌力 ${item.best.value.toFixed(0)}`
    lines.push(line)
  }
  if (review.claims.length) {
    lines.push('')
    lines.push('胡 / 碰 / 吃的取舍（收益为正 = 要了之后手牌更好）：')
    for (const claim of review.claims) {
      const can = [claim.canHu ? '胡' : '', claim.canPeng ? '碰' : '', claim.canChi ? '吃' : ''].filter(Boolean).join('、')
      lines.push(`第${claim.turn}手前 [${GRADE_NAME[claim.grade]}] ${claim.source} ${lhName(lhKind(claim.tile))}，可以${can}，选择了${ACT_NAME[claim.act]}${claim.canHu ? '' : `；收益 ${claim.gain.toFixed(0)}`}`)
    }
  }
  return lines.join('\n').slice(0, 11000)
}

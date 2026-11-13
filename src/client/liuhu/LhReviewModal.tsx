// 六胡抢复盘：逐手点评 + AI 教练（DeepSeek）总评。
import { useMemo, useState } from 'react'
import type { LhResult } from '../../shared/liuhu/game.ts'
import { lhKind, lhName, lhSort } from '../../shared/liuhu/tiles.ts'
import type { LhRecord } from '../../shared/liuhu/view.ts'
import { Button, Modal } from '../components/ui.tsx'
import { api } from '../net.ts'
import { useStore } from '../store.ts'
import { sfx } from '../sound.ts'
import { GRADE_NAME, lhReviewPrompt, reviewLiuhu } from './review.ts'
import { Zi } from './Zi.tsx'

const ACT_NAME = { hu: '胡', peng: '碰', chi: '吃', pass: '过', discard: '打牌' }

export function LhReviewModal({ record, result, matchId, outcome, onClose }: { record: LhRecord; result: LhResult | null; matchId: string; outcome: string; onClose: () => void }) {
  const user = useStore((state) => state.user)!
  const toast = useStore((state) => state.toast)
  const review = useMemo(() => reviewLiuhu(record, result), [record, result])
  const [onlyBad, setOnlyBad] = useState(false)
  const [ai, setAi] = useState<{ text: string; model: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const askAi = async () => {
    if (loading) return
    if (!user.aiKeyMask) return toast('请先到「个人中心 · AI 教练」填写你的 DeepSeek API Key', 'error')
    setLoading(true)
    try {
      setAi(await api<{ text: string; model: string }>('/mahjong/review', { matchId, analysis: lhReviewPrompt(record, review, outcome) }))
      sfx.reward()
    } catch (error) {
      toast((error as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const isBad = (grade: string) => grade === 'miss' || grade === 'blunder'
  const rows = [
    ...review.discards.map((item) => ({ order: item.turn * 2, discard: item, claim: null as null | (typeof review.claims)[number] })),
    ...review.claims.map((item) => ({ order: item.turn * 2 - 1, discard: null as null | (typeof review.discards)[number], claim: item })),
  ].sort((a, b) => a.order - b.order).filter((row) => !onlyBad || isBad((row.discard ?? row.claim)!.grade))

  return (
    <Modal title="本局复盘" onClose={onClose} width={1040}>
      <div className="mj-review">
        <div className="stats mj-review-stats">
          <div><b className="num">{Math.round(review.accuracy * 100)}%</b><small>判断准确率</small></div>
          <div><b className="num">{review.discards.length}</b><small>打牌手数</small></div>
          <div><b className="num">{review.takes}</b><small>吃 / 碰</small></div>
          <div><b className={`num ${review.bad > 0 ? 'down' : ''}`}>{review.bad}</b><small>失误 / 大错</small></div>
          <div><b className="num">{review.tenpaiTurn ? `第 ${review.tenpaiTurn} 手` : '未听'}</b><small>听牌</small></div>
          <div><b className={`num ${review.pao ? 'down' : ''}`}>{review.pao ? '放了' : '没有'}</b><small>放炮</small></div>
        </div>

        <div className="mj-review-body">
          <div className="mj-review-list">
            <div className="mj-review-bar">
              <b>逐手点评</b>
              <label className="check"><input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} /><i />只看失误</label>
            </div>
            <div className="mj-review-rows scroll">
              {rows.length === 0 && <div className="empty">{onlyBad ? '这一局没有明显失误，打得很稳' : '这一局还没轮到你做决定'}</div>}
              {rows.map(({ discard, claim }, index) => discard ? (
                <div key={index} className={`mj-review-row grade-${discard.grade}`}>
                  <span className="mj-review-turn num">{discard.turn}</span>
                  <div className="mj-review-hand lh-review-hand">
                    {lhSort(discard.hand).map((tile) => {
                      const kind = lhKind(tile)
                      return <Zi key={tile} kind={kind} className={`s ${kind === discard.chosen.kind ? 'played' : ''} ${discard.grade !== 'best' && kind === discard.best.kind ? 'better' : ''}`} />
                    })}
                    {discard.melds > 0 && <small className="muted">+{discard.melds} 门</small>}
                  </div>
                  <div className="mj-review-text">
                    <span className={`mj-grade grade-${discard.grade}`}>{GRADE_NAME[discard.grade]}</span>
                    打 <em>{lhName(discard.chosen.kind)}</em>
                    <small>{discard.chosen.waits.length ? `听 ${discard.chosen.waits.map(lhName).join(' ')}` : '未听'}{discard.fresh ? ' · 生牌' : ''}</small>
                    {discard.pao && <span className="lh-pao">放炮</span>}
                    {discard.grade !== 'best' && discard.best.kind !== discard.chosen.kind && (
                      <span className="mj-review-better">
                        更好：打 <em>{lhName(discard.best.kind)}</em>
                        <small>{discard.best.waits.length ? `听 ${discard.best.waits.map(lhName).join(' ')}` : '留住更多搭子'}</small>
                      </span>
                    )}
                    {discard.pao && discard.fresh && <span className="mj-review-better">这张是没人打过的生牌，放炮要一个人付三份。</span>}
                  </div>
                </div>
              ) : claim && (
                <div key={index} className={`mj-review-row claim ${isBad(claim.grade) ? `grade-${claim.grade}` : ''}`}>
                  <span className="mj-review-turn">取舍</span>
                  <div className="mj-review-text">
                    第 {claim.turn} 手前，{claim.source} <em>{lhName(lhKind(claim.tile))}</em>，可以{[claim.canHu ? '胡' : '', claim.canPeng ? '碰' : '', claim.canChi ? '吃' : ''].filter(Boolean).join('、')}，你选择了<b>{ACT_NAME[claim.act]}</b>。
                    <small>
                      {claim.canHu ? (claim.act === 'hu' ? '能胡就胡，抢得对。' : '六胡抢讲究抢，能胡不胡很亏。')
                        : claim.act === 'pass' ? (claim.gain >= 2 ? '要了手牌会更好，这里可以要；放过还成了臭牌。' : '要了也不会更好，过得对。')
                          : claim.gain >= 1 ? '要了之后手牌更近一步，要得对。' : '要了并没有让手牌更好，还亮了牌型，可以不要。'}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mj-review-ai">
            <div className="mj-review-bar">
              <b>AI 教练点评</b>
              <small className="muted">{user.aiKeyMask ? `DeepSeek · ${ai?.model ?? (user.aiModel || 'deepseek-chat')}` : '未设置 API Key'}</small>
            </div>
            <div className="mj-ai-text scroll">
              {!ai && !loading && (
                <div className="empty">
                  让 AI 教练根据左边的数据，<br />写一段有针对性的点评和建议。
                  {!user.aiKeyMask && <small><br />需要先在「个人中心 · AI 教练」里填写你自己的 DeepSeek API Key。</small>}
                </div>
              )}
              {loading && <div className="empty mj-ai-loading">教练正在看牌谱<i>.</i><i>.</i><i>.</i></div>}
              {ai && ai.text.split(/\n+/).map((line, index) => <p key={index}>{line}</p>)}
            </div>
            <div className="modal-actions" style={{ marginTop: 12 }}>
              <Button kind="gold" size="md" disabled={loading || rows.length === 0 && !onlyBad} onClick={() => void askAi()}>{ai ? '重新点评' : '请 AI 教练点评'}</Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// 复盘：逐手牌效点评 + AI 教练（DeepSeek）总评。
import { useMemo, useState } from 'react'
import { ZHONG, kindOf, kindShort, sortTiles } from '../../shared/mahjong/tiles.ts'
import type { MjRecord } from '../../shared/mahjong/view.ts'
import { Button, Modal } from '../components/ui.tsx'
import { api } from '../net.ts'
import { useStore } from '../store.ts'
import { sfx } from '../sound.ts'
import { GRADE_NAME, reviewPrompt, reviewRecord } from './review.ts'
import { Tile } from './Tile.tsx'

export function ReviewModal({ record, matchId, outcome, onClose }: { record: MjRecord; matchId: string; outcome: string; onClose: () => void }) {
  const user = useStore((state) => state.user)!
  const toast = useStore((state) => state.toast)
  const review = useMemo(() => reviewRecord(record), [record])
  const [onlyBad, setOnlyBad] = useState(false)
  const [ai, setAi] = useState<{ text: string; model: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const askAi = async () => {
    if (loading) return
    if (!user.aiKeyMask) return toast('请先到「个人中心 · AI 教练」填写你的 DeepSeek API Key', 'error')
    setLoading(true)
    try {
      const reply = await api<{ text: string; model: string }>('/mahjong/review', { matchId, analysis: reviewPrompt(record, review, outcome) })
      setAi(reply)
      sfx.reward()
    } catch (error) {
      toast((error as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const rows = onlyBad ? review.discards.filter((item) => item.grade === 'miss' || item.grade === 'blunder') : review.discards
  const bad = review.discards.filter((item) => item.grade === 'miss' || item.grade === 'blunder').length

  return (
    <Modal title="本局复盘" onClose={onClose} width={1040}>
      <div className="mj-review">
        <div className="stats mj-review-stats">
          <div><b className="num">{Math.round(review.accuracy * 100)}%</b><small>出牌准确率</small></div>
          <div><b className="num">{review.discards.length}</b><small>出牌手数</small></div>
          <div><b className={`num ${bad > 0 ? 'down' : ''}`}>{bad}</b><small>失误 / 大错</small></div>
          <div><b className="num">{review.totalLoss}</b><small>累计少的进张</small></div>
          <div><b className="num">{review.tenpaiTurn ? `第 ${review.tenpaiTurn} 手` : '未听'}</b><small>听牌</small></div>
          <div><b className="num">{review.kongs}</b><small>杠</small></div>
        </div>

        <div className="mj-review-body">
          <div className="mj-review-list">
            <div className="mj-review-bar">
              <b>逐手点评</b>
              <label className="check"><input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} /><i />只看失误</label>
            </div>
            <div className="mj-review-rows scroll">
              {rows.length === 0 && <div className="empty">{onlyBad ? '这一局没有明显失误，打得很稳' : '这一局还没轮到你出牌'}</div>}
              {rows.map((item) => (
                <div key={item.turn} className={`mj-review-row grade-${item.grade}`}>
                  <span className="mj-review-turn num">{item.turn}</span>
                  <div className="mj-review-hand">
                    {sortTiles(item.hand).map((tile) => {
                      const kind = kindOf(tile)
                      return <Tile key={tile} kind={kind} className={`xxs ${kind === item.chosen.kind ? 'played' : ''} ${item.grade !== 'best' && kind === item.best.kind ? 'better' : ''}`} />
                    })}
                    {item.melds > 0 && <small className="muted">+{item.melds} 组</small>}
                  </div>
                  <div className="mj-review-text">
                    <span className={`mj-grade grade-${item.grade}`}>{GRADE_NAME[item.grade]}</span>
                    打 <em>{kindShort(item.chosen.kind)}</em>
                    <small>{item.chosen.shanten <= 0 ? '听牌' : `${item.chosen.shanten} 向听`} · 进张 {item.chosen.ukeire}</small>
                    {item.grade !== 'best' && (
                      <span className="mj-review-better">
                        {item.chosen.kind === ZHONG ? '红中是万能牌，别打。' : ''}更好：打 <em>{kindShort(item.best.kind)}</em>
                        <small>{item.best.shanten <= 0 ? '听牌' : `${item.best.shanten} 向听`} · 进张 {item.best.ukeire}{item.best.shanten < item.chosen.shanten ? '（离听牌近一步）' : `（多 ${item.loss} 张）`}</small>
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {!onlyBad && review.claims.map((claim, index) => (
                <div key={`c${index}`} className={`mj-review-row claim ${claim.action === 'pass' && claim.helps ? 'grade-miss' : claim.action === 'pung' && !claim.helps ? 'grade-ok' : ''}`}>
                  <span className="mj-review-turn">碰杠</span>
                  <div className="mj-review-text">
                    第 {claim.turn} 手前，别人打出 <em>{kindShort(claim.kind)}</em>，你选择了<b>{claim.action === 'pass' ? '过' : claim.action === 'pung' ? '碰' : '杠'}</b>。
                    <small>
                      {claim.action === 'kong' ? '放杠白拿 3 分，杠得对。'
                        : claim.action === 'pass' && claim.canKong ? '这张可以杠，白拿 3 分还多摸一张，通常该杠。'
                          : claim.helps ? (claim.action === 'pung' ? '碰了手牌更近一步，碰得对。' : '碰了能让手牌更近一步，这里该碰。')
                            : (claim.action === 'pung' ? '碰了并没有让手牌更近，可以不碰。' : '碰了也不会更近，过得对。')}
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
                  让 AI 教练根据上面的牌效数据，<br />写一段有针对性的点评和建议。
                  {!user.aiKeyMask && <small><br />需要先在「个人中心 · AI 教练」里填写你自己的 DeepSeek API Key。</small>}
                </div>
              )}
              {loading && <div className="empty mj-ai-loading">教练正在看牌谱<i>.</i><i>.</i><i>.</i></div>}
              {ai && ai.text.split(/\n+/).map((line, index) => <p key={index}>{line}</p>)}
            </div>
            <div className="modal-actions" style={{ marginTop: 12 }}>
              <Button kind="gold" size="md" disabled={loading || review.discards.length === 0} onClick={() => void askAi()}>{ai ? '重新点评' : '请 AI 教练点评'}</Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

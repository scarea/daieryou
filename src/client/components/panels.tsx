// 大厅弹窗：每日签到、风云榜、我的战绩、玩法规则、个人中心。
import { useEffect, useState } from 'react'
import {
  AVATARS, HALLS, RELIEF_AMOUNT, RELIEF_DAILY_LIMIT, RELIEF_THRESHOLD, SIGNIN_REWARDS, TITLES,
  formatCoins, hallById, levelOf, titleOf,
} from '../../shared/economy.ts'
import { makeCard } from '../../shared/cards.ts'
import type { LeaderboardRow, LedgerItem, MatchRecord, SigninStatus, UserProfile } from '../../shared/protocol.ts'
import { api } from '../net.ts'
import { useStore } from '../store.ts'
import { sfx } from '../sound.ts'
import { CardView } from './CardView.tsx'
import { Avatar, Button, CoinIcon, Coins, Modal, MusicToggle, SoundToggle, TitleBadge, VoiceToggle } from './ui.tsx'

type Close = { onClose: () => void }

// ------------------------------ 每日签到 ------------------------------

export function SigninModal({ onClose }: Close) {
  const user = useStore((state) => state.user)!
  const signin = useStore((state) => state.signin)
  const setUser = useStore((state) => state.setUser)
  const toast = useStore((state) => state.toast)
  const [busy, setBusy] = useState(false)
  const [justSigned, setJustSigned] = useState(-1)

  const claim = async (path: '/me/signin' | '/me/relief') => {
    if (busy) return
    setBusy(true)
    try {
      const before = signin?.nextIndex ?? 0
      const data = await api<{ reward: number; status: SigninStatus; user: UserProfile }>(path, {})
      setUser(data.user, data.status)
      if (path === '/me/signin') setJustSigned(before)
      sfx.reward()
      toast(`获得 ${formatCoins(data.reward)} 金币`, 'gold')
    } catch (error) {
      toast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const signed = signin?.signedToday ?? false
  const nextIndex = signin?.nextIndex ?? 0
  const canRelief = user.coins < RELIEF_THRESHOLD && (signin?.reliefLeft ?? 0) > 0

  return (
    <Modal title="每日签到" onClose={onClose} width={760}>
      <p className="modal-lead">连续签到七日，奖励节节高升；断签则从头再来。</p>
      <div className="signin-grid">
        {SIGNIN_REWARDS.map((reward, index) => {
          const done = signed ? index <= nextIndex : index < nextIndex
          const today = !signed && index === nextIndex
          return (
            <div key={index} className={`signin-day ${done ? 'done' : ''} ${today ? 'today' : ''} ${index === 6 ? 'grand' : ''} ${justSigned === index ? 'pop' : ''}`}>
              <span className="signin-label">第{'一二三四五六七'[index]}天</span>
              <span className="signin-coins">
                {Array.from({ length: Math.min(3, 1 + Math.floor(index / 2)) }, (_, i) => <CoinIcon key={i} size={index === 6 ? 34 : 28} />)}
              </span>
              <b className="num">{formatCoins(reward)}</b>
              {done && <i className="signin-check">已领</i>}
            </div>
          )
        })}
      </div>
      <div className="modal-actions">
        <Button kind="gold" size="lg" disabled={signed || busy || !signin} onClick={() => void claim('/me/signin')}>
          {signed ? '今日已签到' : '签到领取'}
        </Button>
      </div>
      <div className="relief">
        <div>
          <b>财神救济金</b>
          <small>金币低于 {RELIEF_THRESHOLD} 时可领 {formatCoins(RELIEF_AMOUNT)}，每日 {RELIEF_DAILY_LIMIT} 次（今日剩余 {signin?.reliefLeft ?? 0} 次）</small>
        </div>
        <Button kind="red" size="sm" disabled={!canRelief || busy} onClick={() => void claim('/me/relief')}>领取</Button>
      </div>
    </Modal>
  )
}

// ------------------------------ 风云榜 ------------------------------

type BoardKind = 'honor' | 'coins' | 'wins'

export function LeaderboardModal({ onClose }: Close) {
  const user = useStore((state) => state.user)!
  const [kind, setKind] = useState<BoardKind>('honor')
  const [data, setData] = useState<{ rows: LeaderboardRow[]; myRank: number } | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    api<{ rows: LeaderboardRow[]; myRank: number }>(`/leaderboard?kind=${kind}`)
      .then((result) => { if (alive) setData(result) })
      .catch(() => { if (alive) setData({ rows: [], myRank: 0 }) })
    return () => { alive = false }
  }, [kind])

  const value = (row: LeaderboardRow) => {
    if (kind === 'coins') return <Coins value={row.coins} size={17} />
    if (kind === 'wins') return <span className="num board-value">{row.wins} <small>胜 / {row.games} 局</small></span>
    return <span className="num board-value">{row.honor} <small>荣誉</small></span>
  }

  return (
    <Modal title="风云榜" onClose={onClose} width={700}>
      <div className="tabs">
        {([['honor', '荣誉榜'], ['coins', '财富榜'], ['wins', '常胜榜']] as [BoardKind, string][]).map(([key, label]) => (
          <button key={key} type="button" className={`tab ${kind === key ? 'on' : ''}`} onClick={() => { sfx.click(); setKind(key) }}>{label}</button>
        ))}
      </div>
      <div className="board scroll">
        {!data && <div className="empty">榜单加载中…</div>}
        {data && data.rows.length === 0 && <div className="empty">虚位以待 · 打一局即可上榜</div>}
        {data?.rows.map((row) => (
          <div key={row.id} className={`board-row rank-${row.rank} ${row.id === user.id ? 'me' : ''}`}>
            <span className="board-rank num">{row.rank <= 3 ? ['冠', '亚', '季'][row.rank - 1] : row.rank}</span>
            <Avatar index={row.avatar} size={40} ring={false} />
            <span className="board-name">{row.nickname}</span>
            <TitleBadge honor={row.honor} small />
            <span className="board-val">{value(row)}</span>
          </div>
        ))}
      </div>
      <div className="board-foot">
        我的排名：<b className="num">{data?.myRank ? `第 ${data.myRank} 名` : user.isGuest ? '游客不参与排名，绑定账号后上榜' : '未上榜'}</b>
      </div>
    </Modal>
  )
}

// ------------------------------ 我的战绩 ------------------------------

function timeText(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function RecordsModal({ onClose }: Close) {
  const [records, setRecords] = useState<MatchRecord[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    api<{ records: MatchRecord[] }>('/me/records').then((data) => setRecords(data.records)).catch(() => setRecords([]))
  }, [])

  return (
    <Modal title="我的战绩" onClose={onClose} width={760}>
      <div className="records scroll">
        {!records && <div className="empty">加载中…</div>}
        {records && records.length === 0 && <div className="empty">尚无战绩 · 去牌桌上一展身手吧</div>}
        {records?.map((record) => (
          <div key={record.id} className={`record ${open === record.id ? 'open' : ''}`}>
            <button type="button" className="record-head" onClick={() => { sfx.click(); setOpen(open === record.id ? null : record.id) }}>
              <span className={`record-place place-${record.placement}`}>{['头名', '居中', '垫底'][Math.min(2, record.placement - 1)]}</span>
              <span className="record-hall">
                <b>{record.game === 'mahjong' ? '红中麻将' : hallById(record.hallId)?.name ?? '牌桌'}</b>
                <small>{timeText(record.finishedAt)}</small>
              </span>
              <span className="record-players">
                {record.players.map((player, index) => (
                  <span key={index} className={player.me ? 'me' : ''}>
                    <Avatar index={player.avatar} size={26} ring={false} />
                    <em className="num">{player.total > 0 ? `+${player.total}` : player.total}</em>
                  </span>
                ))}
              </span>
              <Coins value={record.coinsDelta} signed size={18} />
              <span className={`record-honor num ${record.honorDelta >= 0 ? 'up' : 'down'}`}>{record.honorDelta >= 0 ? '+' : ''}{record.honorDelta} 誉</span>
            </button>
            {open === record.id && record.game === 'mahjong' && <p className="record-summary">{hallById(record.hallId)?.name} · 每分 {formatCoins(record.stake)} 金币 · {record.summary ?? ''}</p>}
            {open === record.id && record.game !== 'mahjong' && (
              <table className="record-detail">
                <thead>
                  <tr>
                    <th>回合</th>
                    {record.players.map((player, index) => <th key={index} className={player.me ? 'me' : ''}>{player.nickname}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {record.rounds.map((round) => (
                    <tr key={round.round}>
                      <td>第 {round.round} 轮</td>
                      {round.deltas.map((delta, index) => (
                        <td key={index} className={delta > 0 ? 'up' : delta < 0 ? 'down' : ''}>
                          {round.hands[index]} <b className="num">{delta > 0 ? `+${delta}` : delta}</b>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}

// ------------------------------ 玩法规则 ------------------------------

const sample = (codes: string) =>
  codes.split(' ').map((code) => {
    if (code === 'JB') return makeCard(null, 15)
    const rank = { A: 1, J: 11, Q: 12, K: 13 }[code.slice(1)] ?? Number(code.slice(1))
    return makeCard(code[0] as 'S' | 'H' | 'D' | 'C', rank)
  })

const HAND_SAMPLES: [string, string, string][] = [
  ['豹子', '三张点数相同', 'SA HA DA'],
  ['同花顺', '同花色的顺子', 'H5 H6 H7'],
  ['同花', '三张同花色', 'SA SJ S4'],
  ['顺子', '三张点数相连', 'S7 H8 D9'],
  ['对子', '两张点数相同', 'SK DK C4'],
  ['散牌', '以上皆非，比单张', 'SA HJ D4'],
]

export function RulesModal({ onClose, onTutorial }: Close & { onTutorial?: () => void }) {
  return (
    <Modal title="玩法规则" onClose={onClose} width={860}>
      <div className="rules">
        {onTutorial && <div className="rules-tutorial"><Button kind="gold" size="sm" onClick={onTutorial}>观看新手教学</Button></div>}
        <section>
          <h3>一句话玩法</h3>
          <p>三人比牌，<b>第二名是输家（被"逮"）</b>，要分别付给头名和末位各一笔分。所以——要么拿最大，要么干脆最小，唯独别卡在中间。</p>
        </section>
        <section>
          <h3>对局流程</h3>
          <ol>
            <li>一副 54 张牌，<b>大小王是赖子</b>，自动变成能凑出最大牌型的牌。</li>
            <li>开局每人 5 张手牌，桌面 4 张公牌（前 3 张明牌，第 4 张暗牌）。</li>
            <li><b>第 1~4 轮</b>：每人选 2 张手牌，与当轮公牌组成三张牌比大小。出过的牌不再回手。</li>
            <li>第 1~3 轮结束后每人摸 2 张（本轮输家先摸）；第 4 轮公牌是<b>暗牌</b>，出完才翻开，之后不再摸牌。</li>
            <li><b>第 5 轮</b>：没有公牌，各自剩下的 3 张手牌直接比。</li>
          </ol>
        </section>
        <section>
          <h3>牌型大小</h3>
          <div className="rule-hands">
            {HAND_SAMPLES.map(([name, desc, codes], index) => (
              <div key={name} className="rule-hand">
                <span className="rule-rank num">{index + 1}</span>
                <div className="rule-cards">
                  {sample(codes).map((card) => <div key={card.id} className="mini-card"><CardView card={card} /></div>)}
                </div>
                <b>{name}</b>
                <small>{desc}</small>
              </div>
            ))}
          </div>
          <p className="muted">A 最大，可组成 QKA（最大顺子）与 A23（最小顺子）；同牌型比点数，花色不分大小。</p>
        </section>
        <section>
          <h3>计分</h3>
          <ul>
            <li>五轮的基础分依次为 <b>1、2、3、4、5</b> 分，越往后越值钱。</li>
            <li>第二名分别付给头名、末位各一笔基础分；<b>豹子对豹子</b>的那一笔翻倍。</li>
            <li>并列头名：剩下那家付分；并列第二：两家都付给头名；三家全平：本轮不结算。</li>
            <li>一局结束，<b>总分 × 底注</b> 即为输赢的金币；整局名次决定荣誉分与爵位升降。</li>
          </ul>
        </section>
        <section>
          <h3>场次与爵位</h3>
          <div className="rule-tags">
            {HALLS.map((hall) => <span key={hall.id}>{hall.name} · 底注 {formatCoins(hall.stake)} · {formatCoins(hall.minCoins)} 入场</span>)}
          </div>
          <div className="rule-tags">
            {TITLES.map((title) => <span key={title.name} style={{ color: title.color, borderColor: title.color }}>{title.name} {title.min}+</span>)}
          </div>
        </section>
      </div>
    </Modal>
  )
}

// ------------------------------ 个人中心 ------------------------------

export function ProfileModal({ onClose }: Close) {
  const user = useStore((state) => state.user)!
  const setUser = useStore((state) => state.setUser)
  const logout = useStore((state) => state.logout)
  const toast = useStore((state) => state.toast)
  const [tab, setTab] = useState<'info' | 'ledger' | 'bind' | 'safe' | 'ai' | 'prefs'>('info')
  const [aiKey, setAiKey] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const setRecoveryCode = useStore((state) => state.setRecoveryCode)
  const [adminKey, setAdminKey] = useState('')
  const [nickname, setNickname] = useState(user.nickname)
  const [ledger, setLedger] = useState<LedgerItem[] | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    if (tab === 'ledger' && !ledger) api<{ items: LedgerItem[] }>('/me/ledger').then((data) => setLedger(data.items)).catch(() => setLedger([]))
  }, [tab, ledger])

  const level = levelOf(user.exp)
  const rank = titleOf(user.honor)
  const winRate = user.games ? Math.round((user.wins / user.games) * 100) : 0

  const save = async (patch: { nickname?: string; avatar?: number }) => {
    try {
      const data = await api<{ user: UserProfile }>('/me/profile', patch)
      setUser(data.user)
      if (patch.nickname !== undefined) toast('昵称已更新', 'gold')
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  const bind = async () => {
    try {
      const data = await api<{ user: UserProfile; recoveryCode: string }>('/auth/upgrade', { username, password })
      setUser(data.user)
      sfx.reward()
      toast('绑定成功，获赠 2,000 金币', 'gold')
      setTab('info')
      setRecoveryCode(data.recoveryCode)
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  const saveAi = async (body: { apiKey?: string; model?: string }, message: string) => {
    if (aiBusy) return
    setAiBusy(true)
    try {
      const data = await api<{ user: UserProfile }>('/me/ai', body)
      setUser(data.user)
      if (body.apiKey !== undefined) setAiKey('')
      toast(message, 'gold')
    } catch (error) {
      toast((error as Error).message, 'error')
    } finally {
      setAiBusy(false)
    }
  }

  const testAi = async () => {
    if (aiBusy) return
    setAiBusy(true)
    try {
      const reply = await api<{ text: string; model: string }>('/me/ai/test', {})
      sfx.reward()
      toast(`连接成功（${reply.model}）`, 'gold')
    } catch (error) {
      toast((error as Error).message, 'error')
    } finally {
      setAiBusy(false)
    }
  }

  const regenerate = async () => {
    try {
      const data = await api<{ recoveryCode: string }>('/me/recovery', {})
      setRecoveryCode(data.recoveryCode)
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  const claimAdmin = async () => {
    try {
      const data = await api<{ user: UserProfile }>('/admin/claim', { key: adminKey })
      setUser(data.user)
      setAdminKey('')
      sfx.fanfare()
      toast('管理员认证成功，大厅左侧已出现「运营后台」', 'gold')
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  return (
    <Modal title="个人中心" onClose={onClose} width={820}>
      <div className="tabs">
        <button type="button" className={`tab ${tab === 'info' ? 'on' : ''}`} onClick={() => setTab('info')}>我的档案</button>
        <button type="button" className={`tab ${tab === 'ledger' ? 'on' : ''}`} onClick={() => setTab('ledger')}>金币流水</button>
        <button type="button" className={`tab ${tab === 'ai' ? 'on' : ''}`} onClick={() => setTab('ai')}>AI 教练</button>
        <button type="button" className={`tab ${tab === 'prefs' ? 'on' : ''}`} onClick={() => setTab('prefs')}>偏好</button>
        {user.isGuest
          ? <button type="button" className={`tab ${tab === 'bind' ? 'on' : ''}`} onClick={() => setTab('bind')}>绑定账号</button>
          : <button type="button" className={`tab ${tab === 'safe' ? 'on' : ''}`} onClick={() => setTab('safe')}>账号安全</button>}
      </div>

      {tab === 'info' && (
        <div className="profile">
          <div className="profile-head">
            <Avatar index={user.avatar} size={96} frame={user.frame} />
            <div className="profile-id">
              <div className="profile-name-row">
                <input className="input plain" value={nickname} maxLength={12} onChange={(e) => setNickname(e.target.value)} />
                <Button kind="ghost" size="sm" disabled={!nickname.trim() || nickname === user.nickname} onClick={() => void save({ nickname })}>改名</Button>
              </div>
              <div className="profile-meta">
                <TitleBadge honor={user.honor} />
                <span className="level-tag">Lv.{level.level}</span>
                <span className="muted">{user.isGuest ? '游客账号' : `账号 ${user.username}`}</span>
              </div>
              <div className="profile-bars">
                <label>经验 <div className="bar"><i style={{ width: `${(level.current / level.need) * 100}%` }} /></div> <small className="num">{level.current}/{level.need}</small></label>
                <label>荣誉 <div className="bar honor"><i style={{ width: `${rank.progress * 100}%` }} /></div> <small className="num">{rank.next ? `${user.honor}/${rank.next.min}` : user.honor}</small></label>
              </div>
            </div>
          </div>
          <div className="avatar-picker wide">
            {AVATARS.map((def, index) => (
              <button key={def.glyph} type="button" className={`avatar-option ${user.avatar === index ? 'on' : ''}`} title={def.name} onClick={() => { sfx.select(); void save({ avatar: index }) }}>
                <Avatar index={index} size={44} ring={false} />
              </button>
            ))}
          </div>
          <div className="stats">
            <div><b className="num">{formatCoins(user.coins)}</b><small>金币</small></div>
            <div><b className="num">{user.games}</b><small>总局数</small></div>
            <div><b className="num">{winRate}%</b><small>头名率</small></div>
            <div><b className="num">{user.caught}</b><small>被逮轮数</small></div>
            <div><b className="num">{user.leopards}</b><small>豹子</small></div>
            <div><b className="num">{formatCoins(user.bestWin)}</b><small>单局最高赢取</small></div>
          </div>
          <div className="modal-actions">
            <Button kind="ghost" size="md" onClick={() => { onClose(); void logout() }}>退出登录</Button>
          </div>
        </div>
      )}

      {tab === 'ledger' && (
        <div className="ledger scroll">
          {!ledger && <div className="empty">加载中…</div>}
          {ledger?.length === 0 && <div className="empty">暂无流水</div>}
          {ledger?.map((item) => (
            <div key={item.id} className="ledger-row">
              <span className="ledger-reason">{item.reason}<small>{timeText(item.createdAt)}</small></span>
              <Coins value={item.delta} signed size={17} />
              <span className="ledger-balance num">余 {formatCoins(item.balance)}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'ai' && (
        <div className="ai-settings">
          <p className="modal-lead">红中麻将的「AI 教练点评」由 <b>DeepSeek</b> 提供。填入你自己的 API Key 后，每局结束可以让 AI 根据牌效数据写复盘。</p>
          <div className={`ai-state ${user.aiKeyMask ? 'on' : ''}`}>
            <span>{user.aiKeyMask ? <>已保存 API Key：<b>{user.aiKeyMask}</b></> : '尚未设置 API Key'}</span>
            {user.aiKeyMask && (
              <span style={{ display: 'flex', gap: 8 }}>
                <Button kind="jade" size="sm" disabled={aiBusy} onClick={() => void testAi()}>测试连接</Button>
                <Button kind="ghost" size="sm" disabled={aiBusy} onClick={() => void saveAi({ apiKey: '' }, '已清除 API Key')}>清除</Button>
              </span>
            )}
          </div>
          <label className="field">
            <em>API Key</em>
            <input className="input" type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value.trim())} placeholder={user.aiKeyMask ? '填入新的 Key 可替换' : 'sk-…（在 DeepSeek 开放平台创建）'} autoComplete="off" maxLength={200} />
          </label>
          <div className="ai-models">
            模型
            {['deepseek-chat', 'deepseek-reasoner'].map((model) => (
              <button key={model} type="button" className={`tab ${(user.aiModel || 'deepseek-chat') === model ? 'on' : ''}`} onClick={() => void saveAi({ model }, `已切换到 ${model}`)}>{model === 'deepseek-chat' ? '对话模型（快）' : '推理模型（慢而细）'}</button>
            ))}
          </div>
          <div className="modal-actions">
            <Button kind="gold" size="md" disabled={aiBusy || aiKey.length < 16} onClick={() => void saveAi({ apiKey: aiKey }, 'API Key 已保存')}>保存 API Key</Button>
          </div>
          <p className="ai-note">
            · Key 加密后保存在服务器，只用于替你调用 DeepSeek；页面上只显示掩码，任何接口都不会返回明文。<br />
            · 调用产生的费用由你的 DeepSeek 账户承担，一次复盘大约消耗 1~2 千个 token。<br />
            · 不填 Key 也能用逐手的牌效复盘，只是没有 AI 的文字点评。
          </p>
        </div>
      )}

      {tab === 'prefs' && (
        <div className="prefs">
          <div className="pref-row"><div><b>背景音乐</b><small>大厅与牌桌的背景音乐</small></div><MusicToggle /></div>
          <div className="pref-row"><div><b>音效</b><small>出牌、碰杠、结算等所有音效</small></div><SoundToggle /></div>
          <div className="pref-row"><div><b>语音报牌</b><small>麻将里用语音念出打出的牌和「碰」「杠」「自摸」（使用浏览器自带的中文语音）</small></div><VoiceToggle /></div>
          <p className="ai-note">麻将的「教练提示」开关在牌桌右上角，可以随时打开或关闭。</p>
        </div>
      )}

      {tab === 'safe' && (
        <div className="safe">
          <div className="relief">
            <div>
              <b>恢复码</b>
              <small>忘记密码时凭「账号 + 恢复码」重设密码。重新生成后旧的恢复码立即失效。</small>
            </div>
            <Button kind="red" size="sm" onClick={() => void regenerate()}>重新生成</Button>
          </div>
          {!user.isAdmin && (
            <div className="relief">
              <div>
                <b>管理员认证</b>
                <small>输入部署时设置的管理员口令，开启运营后台。</small>
              </div>
              <input className="input plain admin-key" type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)} placeholder="管理员口令" />
              <Button kind="ghost" size="sm" disabled={!adminKey} onClick={() => void claimAdmin()}>认证</Button>
            </div>
          )}
          {user.isAdmin && <p className="modal-lead" style={{ marginTop: 18 }}>你是管理员，可从大厅左侧进入「运营后台」。</p>}
        </div>
      )}

      {tab === 'bind' && (
        <div className="bind">
          <p className="modal-lead">绑定账号密码后，金币与战绩永久保存，可在任意设备登录、登上风云榜，并获赠 <b>2,000</b> 金币。</p>
          <label className="field"><em>账号</em><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="3~16 位字母或数字" maxLength={16} /></label>
          <label className="field"><em>密码</em><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 6 位" maxLength={64} /></label>
          <div className="modal-actions"><Button kind="gold" size="lg" onClick={() => void bind()}>立即绑定</Button></div>
        </div>
      )}
    </Modal>
  )
}

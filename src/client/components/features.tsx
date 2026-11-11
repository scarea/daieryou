// 商城、任务与成就、好友、运营后台、恢复码、新手教学。
import { ReactNode, useCallback, useEffect, useState } from 'react'
import { makeCard } from '../../shared/cards.ts'
import { formatCoins, titleOf } from '../../shared/economy.ts'
import type { GrowthItem } from '../../shared/growth.ts'
import type { AdminStats, AdminUser, FriendInfo, UserProfile } from '../../shared/protocol.ts'
import { SHOP_ITEMS, SHOP_KIND_NAME, ShopItem, ShopKind } from '../../shared/shop.ts'
import { api } from '../net.ts'
import { useStore } from '../store.ts'
import { sfx } from '../sound.ts'
import { CardView } from './CardView.tsx'
import { Avatar, Button, CoinIcon, Coins, Modal, TitleBadge } from './ui.tsx'

type Close = { onClose: () => void }

// ------------------------------ 商城 ------------------------------

function ItemPreview({ item, avatar }: { item: ShopItem | null; kind: ShopKind; avatar: number }) {
  if (!item || item.kind === 'frame') return <Avatar index={avatar} size={68} frame={item?.id ?? ''} />
  if (item.kind === 'cardback') {
    return (
      <div className={`shop-card cb-${item.id}`}>
        <CardView faceUp={false} />
      </div>
    )
  }
  return <div className={`shop-felt felt-${item.id}`}><i /></div>
}

export function ShopModal({ onClose }: Close) {
  const user = useStore((state) => state.user)!
  const setUser = useStore((state) => state.setUser)
  const toast = useStore((state) => state.toast)
  const [kind, setKind] = useState<ShopKind>('frame')
  const [busy, setBusy] = useState(false)

  const act = async (path: '/shop/buy' | '/shop/equip', body: Record<string, unknown>, message: string) => {
    if (busy) return
    setBusy(true)
    try {
      const data = await api<{ user: UserProfile }>(path, body)
      setUser(data.user)
      if (path === '/shop/buy') sfx.reward()
      else sfx.select()
      toast(message, 'gold')
    } catch (error) {
      toast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const equipped = user[kind]
  const items = SHOP_ITEMS.filter((item) => item.kind === kind)

  return (
    <Modal title="珍宝阁" onClose={onClose} width={860}>
      <div className="shop-head">
        <div className="tabs">
          {(Object.keys(SHOP_KIND_NAME) as ShopKind[]).map((key) => (
            <button key={key} type="button" className={`tab ${kind === key ? 'on' : ''}`} onClick={() => { sfx.click(); setKind(key) }}>{SHOP_KIND_NAME[key]}</button>
          ))}
        </div>
        <div className="shop-wallet">我的金币 <Coins value={user.coins} size={19} /></div>
      </div>
      <div className="shop-grid">
        <div className={`shop-item ${equipped === '' ? 'equipped' : ''}`}>
          <div className="shop-preview"><ItemPreview item={null} kind={kind} avatar={user.avatar} />{kind !== 'frame' && <span className="shop-default">经典</span>}</div>
          <b>经典{SHOP_KIND_NAME[kind]}</b>
          <small>入殿即有的默认款</small>
          {equipped === ''
            ? <span className="shop-state">使用中</span>
            : <Button kind="ghost" size="sm" disabled={busy} onClick={() => void act('/shop/equip', { kind, id: '' }, '已换回经典款')}>使用</Button>}
        </div>
        {items.map((item) => {
          const owned = user.items.includes(item.id)
          const using = equipped === item.id
          return (
            <div key={item.id} className={`shop-item ${using ? 'equipped' : ''}`}>
              <div className="shop-preview"><ItemPreview item={item} kind={kind} avatar={user.avatar} /></div>
              <b>{item.name}</b>
              <small>{item.desc}</small>
              {using ? (
                <span className="shop-state">使用中</span>
              ) : owned ? (
                <Button kind="ghost" size="sm" disabled={busy} onClick={() => void act('/shop/equip', { kind, id: item.id }, `已装备「${item.name}」`)}>使用</Button>
              ) : (
                <Button kind="gold" size="sm" disabled={busy || user.coins < item.price} onClick={() => void act('/shop/buy', { id: item.id }, `购得「${item.name}」`)}>
                  <CoinIcon size={16} /> {formatCoins(item.price)}
                </Button>
              )}
            </div>
          )
        })}
      </div>
      <p className="modal-lead" style={{ marginTop: 16, marginBottom: 0 }}>外观仅作装饰，不影响牌局输赢。头像框会展示给同桌玩家。</p>
    </Modal>
  )
}

// ------------------------------ 任务与成就 ------------------------------

interface Growth {
  tasks: GrowthItem[]
  achievements: GrowthItem[]
  season: { id: string; daysLeft: number }
}

export function GrowthModal({ onClose }: Close) {
  const user = useStore((state) => state.user)!
  const setUser = useStore((state) => state.setUser)
  const toast = useStore((state) => state.toast)
  const [tab, setTab] = useState<'tasks' | 'achievements'>('tasks')
  const [growth, setGrowth] = useState<Growth | null>(null)

  const load = useCallback(() => api<Growth>('/me/growth').then(setGrowth).catch(() => setGrowth({ tasks: [], achievements: [], season: { id: '', daysLeft: 0 } })), [])
  useEffect(() => { void load() }, [load])

  const claim = async (item: GrowthItem) => {
    try {
      const data = await api<{ reward: number; user: UserProfile }>('/me/growth/claim', { id: item.id })
      setUser(data.user)
      sfx.reward()
      toast(`「${item.title}」达成，获得 ${formatCoins(data.reward)} 金币`, 'gold')
      void load()
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  const list = tab === 'tasks' ? growth?.tasks : growth?.achievements
  const rank = titleOf(user.honor)
  const pending = (items?: GrowthItem[]) => items?.filter((item) => item.done && !item.claimed).length ?? 0

  return (
    <Modal title="功名录" onClose={onClose} width={780}>
      <div className="season">
        <div>
          <b>{growth?.season.id.replace('-', ' 年 ')} 月赛季</b>
          <small>还剩 {growth?.season.daysLeft ?? '…'} 天 · 赛季结束按爵位发放金币，荣誉分保留四成</small>
        </div>
        <div className="season-title">
          <TitleBadge honor={user.honor} />
          <small>{rank.next ? `距「${rank.next.name}」还差 ${rank.next.min - user.honor}` : '已登峰造极'}</small>
        </div>
      </div>
      <div className="tabs">
        <button type="button" className={`tab ${tab === 'tasks' ? 'on' : ''}`} onClick={() => setTab('tasks')}>每日任务{pending(growth?.tasks) > 0 && <i className="tab-dot" />}</button>
        <button type="button" className={`tab ${tab === 'achievements' ? 'on' : ''}`} onClick={() => setTab('achievements')}>成就{pending(growth?.achievements) > 0 && <i className="tab-dot" />}</button>
      </div>
      <div className="growth scroll">
        {!growth && <div className="empty">加载中…</div>}
        {list?.map((item) => (
          <div key={item.id} className={`growth-row ${item.claimed ? 'claimed' : item.done ? 'done' : ''}`}>
            <span className="growth-icon">{item.claimed ? '✓' : tab === 'tasks' ? '令' : '勋'}</span>
            <div className="growth-info">
              <b>{item.title}</b>
              <small>{item.desc}</small>
              <div className="bar"><i style={{ width: `${(item.progress / item.target) * 100}%` }} /></div>
            </div>
            <span className="growth-progress num">{formatCoins(item.progress)}/{formatCoins(item.target)}</span>
            <Coins value={item.reward} size={17} />
            {item.claimed
              ? <span className="shop-state">已领取</span>
              : <Button kind={item.done ? 'gold' : 'ghost'} size="sm" disabled={!item.done} onClick={() => void claim(item)}>{item.done ? '领取' : '未达成'}</Button>}
          </div>
        ))}
      </div>
    </Modal>
  )
}

// ------------------------------ 好友 ------------------------------

export function FriendsModal({ onClose }: Close) {
  const send = useStore((state) => state.send)
  const toast = useStore((state) => state.toast)
  const [friends, setFriends] = useState<FriendInfo[] | null>(null)
  const [name, setName] = useState('')

  const load = useCallback(() => api<{ friends: FriendInfo[] }>('/friends').then((data) => setFriends(data.friends)).catch(() => setFriends([])), [])
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 8000)
    return () => window.clearInterval(timer)
  }, [load])

  const add = async () => {
    if (!name.trim()) return
    try {
      await api('/friends/add', { username: name.trim() })
      setName('')
      toast('已添加好友', 'gold')
      void load()
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  const remove = async (friend: FriendInfo) => {
    await api('/friends/remove', { userId: friend.id }).catch(() => {})
    void load()
  }

  const go = async (op: 'join' | 'spectate', roomId: string) => {
    if (await send({ op, roomId })) onClose()
  }

  return (
    <Modal title="好友" onClose={onClose} width={700}>
      <form className="friend-add" onSubmit={(event) => { event.preventDefault(); void add() }}>
        <input className="input plain" value={name} onChange={(e) => setName(e.target.value)} placeholder="输入对方的账号添加好友" maxLength={16} />
        <button type="submit" className="btn btn-gold btn-sm"><span>添加</span></button>
      </form>
      <div className="friends scroll">
        {!friends && <div className="empty">加载中…</div>}
        {friends?.length === 0 && <div className="empty">还没有好友<br /><small>对局结束后可以把同桌玩家加为好友</small></div>}
        {friends?.map((friend) => (
          <div key={friend.id} className={`friend-row ${friend.online ? 'online' : ''}`}>
            <Avatar index={friend.avatar} size={44} frame={friend.frame} dim={!friend.online} />
            <div className="friend-info">
              <b>{friend.nickname} <TitleBadge honor={friend.honor} small /></b>
              <small>
                {!friend.online ? '离线' : !friend.room ? '在线 · 大厅闲逛' : friend.room.status === 'playing' ? '在线 · 对局中' : '在线 · 牌桌等人'}
              </small>
            </div>
            {friend.room?.joinable && <Button kind="jade" size="sm" onClick={() => void go('join', friend.room!.id)}>加入</Button>}
            {friend.room && friend.room.status === 'playing' && <Button kind="ghost" size="sm" onClick={() => void go('spectate', friend.room!.id)}>观战</Button>}
            <button type="button" className="friend-remove" title="删除好友" onClick={() => void remove(friend)}>✕</button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

// ------------------------------ 恢复码 ------------------------------

export function RecoveryModal() {
  const code = useStore((state) => state.recoveryCode)
  const setRecoveryCode = useStore((state) => state.setRecoveryCode)
  const toast = useStore((state) => state.toast)
  if (!code) return null
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      toast('恢复码已复制', 'gold')
    } catch {
      toast('复制失败，请手动抄写', 'error')
    }
  }
  return (
    <Modal title="请保存恢复码" onClose={() => setRecoveryCode(null)} width={560}>
      <p className="modal-lead">忘记密码时，凭<b>账号 + 恢复码</b>即可重设密码。<br />它只显示这一次，请截图或抄写保存。</p>
      <button type="button" className="recovery-code num" onClick={() => void copy()}>{code}</button>
      <div className="modal-actions">
        <Button kind="ghost" size="md" onClick={() => void copy()}>复制</Button>
        <Button kind="gold" size="md" onClick={() => setRecoveryCode(null)}>我已保存</Button>
      </div>
    </Modal>
  )
}

// ------------------------------ 运营后台 ------------------------------

const dateText = (timestamp: number) => {
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function AdminModal({ onClose }: Close) {
  const toast = useStore((state) => state.toast)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [keyword, setKeyword] = useState('')
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [selected, setSelected] = useState<AdminUser | null>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [tempPassword, setTempPassword] = useState('')

  const search = useCallback(async (q: string) => {
    try {
      const data = await api<{ users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`)
      setUsers(data.users)
    } catch (error) {
      toast((error as Error).message, 'error')
      setUsers([])
    }
  }, [toast])

  useEffect(() => {
    api<AdminStats>('/admin/stats').then(setStats).catch(() => {})
    void search('')
  }, [search])

  const apply = (user: AdminUser) => {
    setSelected(user)
    setUsers((list) => list?.map((item) => (item.id === user.id ? user : item)) ?? null)
  }

  const run = async (task: () => Promise<void>) => {
    try {
      await task()
    } catch (error) {
      toast((error as Error).message, 'error')
    }
  }

  const stat = (label: string, value: ReactNode) => <div><b className="num">{value}</b><small>{label}</small></div>

  return (
    <Modal title="运营后台" onClose={onClose} width={980}>
      <div className="stats admin-stats">
        {stat('在线', stats?.online ?? '…')}
        {stat('牌桌', stats?.rooms ?? '…')}
        {stat('总用户', stats?.users ?? '…')}
        {stat('其中游客', stats?.guests ?? '…')}
        {stat('今日新增', stats?.newToday ?? '…')}
        {stat('今日对局', stats?.matchesToday ?? '…')}
        {stat('累计对局', stats?.matchesTotal ?? '…')}
        {stat('金币总量', stats ? formatCoins(stats.coinsTotal) : '…')}
      </div>
      <div className="admin-body">
        <div className="admin-list">
          <form className="friend-add" onSubmit={(event) => { event.preventDefault(); void search(keyword) }}>
            <input className="input plain" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索昵称 / 账号 / 用户 ID" />
            <button type="submit" className="btn btn-ghost btn-sm"><span>搜索</span></button>
          </form>
          <div className="admin-users scroll">
            {users?.length === 0 && <div className="empty">没有找到用户</div>}
            {users?.map((user) => (
              <button key={user.id} type="button" className={`admin-user ${selected?.id === user.id ? 'on' : ''} ${user.banned ? 'banned' : ''}`} onClick={() => { setSelected(user); setTempPassword('') }}>
                <Avatar index={user.avatar} size={34} ring={false} dim={!user.online} />
                <span className="admin-name">
                  <b>{user.nickname}</b>
                  <small>{user.isGuest ? '游客' : user.username}{user.isAdmin ? ' · 管理员' : ''}{user.banned ? ' · 已封禁' : ''}</small>
                </span>
                <Coins value={user.coins} size={14} />
              </button>
            ))}
          </div>
        </div>
        <div className="admin-detail">
          {!selected && <div className="empty">选择左侧用户进行管理</div>}
          {selected && (
            <>
              <div className="admin-head">
                <Avatar index={selected.avatar} size={56} />
                <div>
                  <b>{selected.nickname} <TitleBadge honor={selected.honor} small /></b>
                  <small>{selected.isGuest ? '游客账号' : `账号 ${selected.username}`} · {selected.online ? '在线' : '离线'}</small>
                  <small className="admin-id">{selected.id}</small>
                </div>
              </div>
              <div className="admin-facts">
                <span>金币 <b className="num">{formatCoins(selected.coins)}</b></span>
                <span>荣誉 <b className="num">{selected.honor}</b></span>
                <span>局数 <b className="num">{selected.games}</b></span>
                <span>注册 <b className="num">{dateText(selected.createdAt)}</b></span>
                <span>最近登录 <b className="num">{dateText(selected.lastLoginAt)}</b></span>
              </div>
              <div className="admin-form">
                <input className="input plain" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d-]/g, ''))} placeholder="金币数量（负数为扣除）" inputMode="numeric" />
                <input className="input plain" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="备注（会写进流水）" maxLength={30} />
                <Button kind="gold" size="sm" disabled={!amount || amount === '-'} onClick={() => void run(async () => {
                  const data = await api<{ user: AdminUser }>('/admin/grant', { userId: selected.id, amount: Number(amount), reason })
                  apply(data.user)
                  setAmount('')
                  toast('金币已发放', 'gold')
                })}>发放</Button>
              </div>
              <div className="admin-actions">
                <Button kind={selected.banned ? 'jade' : 'red'} size="sm" disabled={selected.isAdmin} onClick={() => void run(async () => {
                  const data = await api<{ user: AdminUser }>('/admin/ban', { userId: selected.id, banned: !selected.banned })
                  apply(data.user)
                  toast(data.user.banned ? '已封禁并踢下线' : '已解封')
                })}>{selected.banned ? '解除封禁' : '封禁账号'}</Button>
                <Button kind="ghost" size="sm" disabled={selected.isGuest} onClick={() => void run(async () => {
                  const data = await api<{ password: string }>('/admin/reset-password', { userId: selected.id })
                  setTempPassword(data.password)
                })}>重置密码</Button>
              </div>
              {tempPassword && (
                <p className="admin-temp">临时密码：<b className="num">{tempPassword}</b><br /><small>请转交给玩家，并提醒登录后尽快修改。此密码只显示这一次。</small></p>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------ 新手教学 ------------------------------

const cards = (codes: string) =>
  codes.split(' ').map((code) => {
    if (code === 'JB') return makeCard(null, 15)
    const rank = { A: 1, J: 11, Q: 12, K: 13 }[code.slice(1)] ?? Number(code.slice(1))
    return makeCard(code[0] as 'S' | 'H' | 'D' | 'C', rank)
  })

function MiniHand({ codes, label, tone, note }: { codes: string; label: string; tone: 'win' | 'lose'; note: string }) {
  return (
    <div className={`tut-hand ${tone}`}>
      <div className="tut-cards">{cards(codes).map((card) => <div key={card.id} className="tut-card"><CardView card={card} /></div>)}</div>
      <b>{label}</b>
      <small>{note}</small>
      {tone === 'lose' && <i className="tut-stamp">逮</i>}
    </div>
  )
}

const TUTORIAL_KEY = 'daieryou.tutorialDone'
export const tutorialSeen = () => {
  try {
    return localStorage.getItem(TUTORIAL_KEY) === '1'
  } catch {
    return true
  }
}

export function Tutorial({ onClose }: Close) {
  const [step, setStep] = useState(0)
  const finish = () => {
    try {
      localStorage.setItem(TUTORIAL_KEY, '1')
    } catch {
      // ignore
    }
    onClose()
  }

  const steps: { title: string; body: ReactNode }[] = [
    {
      title: '第二名才是输家',
      body: (
        <>
          <p>三个人比牌。<b>牌最大的和牌最小的都算赢</b>，夹在中间的第二名被"逮"，要给另外两家各付一笔分。</p>
          <div className="tut-row">
            <MiniHand codes="SA HA DA" label="头名" tone="win" note="豹子 · 收分" />
            <MiniHand codes="S7 H8 D9" label="第二名" tone="lose" note="顺子 · 付两家" />
            <MiniHand codes="S2 H5 D9" label="末位" tone="win" note="散牌 · 也收分" />
          </div>
        </>
      ),
    },
    {
      title: '每轮出两张，配一张公牌',
      body: (
        <>
          <p>你有 5 张手牌。每一轮从中<b>选 2 张</b>，和桌面上高亮的那张<b>公牌</b>凑成三张来比。出过的牌不会再回到手里。</p>
          <div className="tut-row tut-formula">
            <div className="tut-cards">{cards('HK H9').map((card) => <div key={card.id} className="tut-card"><CardView card={card} /></div>)}</div>
            <span>+</span>
            <div className="tut-cards"><div className="tut-card glow"><CardView card={cards('HA')[0]} tag="公" /></div></div>
            <span>=</span>
            <b className="tut-result">同花</b>
          </div>
        </>
      ),
    },
    {
      title: '五轮一局，越往后越值钱',
      body: (
        <>
          <p>一局共 5 轮，每轮的分值是 <b>1、2、3、4、5</b>。前三轮打完各摸 2 张牌。</p>
          <div className="tut-rounds">
            {[['第 1 轮', '×1', '明牌'], ['第 2 轮', '×2', '明牌'], ['第 3 轮', '×3', '明牌'], ['第 4 轮', '×4', '暗牌'], ['终局', '×5', '直接比']].map(([name, score, note], index) => (
              <div key={name} className={index >= 3 ? 'hot' : ''}><small>{name}</small><b className="num">{score}</b><em>{note}</em></div>
            ))}
          </div>
          <p><b>第 4 轮</b>的公牌是盖着的，出完才翻开。<b>终局</b>没有公牌，用你剩下的 3 张手牌直接比。</p>
        </>
      ),
    },
    {
      title: '大小王是赖子',
      body: (
        <>
          <p>大王、小王可以<b>变成任何一张牌</b>，系统会自动帮你变成最合适的那张，凑出最大的牌型。</p>
          <div className="tut-row tut-formula">
            <div className="tut-cards">{cards('SK HK JB').map((card) => <div key={card.id} className="tut-card"><CardView card={card} /></div>)}</div>
            <span>=</span>
            <b className="tut-result gold">豹子 K</b>
          </div>
          <p className="muted">牌型大小：豹子 &gt; 同花顺 &gt; 同花 &gt; 顺子 &gt; 对子 &gt; 散牌</p>
        </>
      ),
    },
    {
      title: '三条诀窍',
      body: (
        <ol className="tut-tips">
          <li><b>够不着最大，就出最小。</b>牌桌右下角有「出最大」「出最小」两个快捷按钮。</li>
          <li><b>好牌往后留。</b>第 4 轮和终局的分值最高，赖子和对子别急着用。</li>
          <li><b>第 4 轮要留一手。</b>出完这轮，剩下的 3 张就是你的终局牌。</li>
        </ol>
      ),
    },
  ]
  const current = steps[step]
  const last = step === steps.length - 1

  return (
    <Modal title="新手教学" onClose={finish} width={780}>
      <div className="tutorial">
        <div className="tut-dots">{steps.map((_, index) => <i key={index} className={index === step ? 'on' : index < step ? 'done' : ''} />)}</div>
        <h3 key={step} className="tut-title gold-text">{current.title}</h3>
        <div key={`body-${step}`} className="tut-body">{current.body}</div>
        <div className="modal-actions">
          {step > 0 && <Button kind="ghost" size="md" onClick={() => setStep(step - 1)}>上一步</Button>}
          <Button kind="gold" size="md" onClick={() => (last ? finish() : setStep(step + 1))}>{last ? '开始第一局' : '下一步'}</Button>
        </div>
      </div>
    </Modal>
  )
}

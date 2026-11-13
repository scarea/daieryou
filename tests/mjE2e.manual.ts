// 红中麻将端到端测试：对着运行中的服务器，一名游客 + 3 个机器人打完一整局。
// 用法：node --import tsx tests/mjE2e.manual.ts [http://localhost:8787]
import WebSocket from 'ws'
import type { MjView } from '../src/shared/mahjong/view.ts'
import type { ServerEvent, UserProfile } from '../src/shared/protocol.ts'

const base = process.argv[2] || 'http://localhost:8787'
const assert = (cond: unknown, message: string) => { if (!cond) { console.error('✗', message); process.exit(1) } else console.log('✓', message) }
const post = async (path: string, body: unknown, token = '') =>
  (await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json() as Promise<any>

const guest = await post('/api/auth/guest', {}) as { token: string; user: UserProfile }
assert(guest.token, '游客登录')
const ws = new WebSocket(base.replace('http', 'ws') + '/ws')
let table: MjView | null = null
let seq = 0
const waiters = new Map<number, (event: any) => void>()
const send = (op: Record<string, unknown>) => new Promise<any>((resolve) => { seq += 1; waiters.set(seq, resolve); ws.send(JSON.stringify({ ...op, id: seq })) })
ws.on('message', (raw) => {
  const event = JSON.parse(raw.toString()) as ServerEvent
  if (event.ev === 'res') waiters.get(event.id)?.(event)
  if (event.ev === 'mj') table = event.table
})
await new Promise<void>((resolve) => ws.on('open', () => resolve()))
assert((await send({ op: 'auth', token: guest.token })).ok, '连接认证')
assert((await send({ op: 'mj:start', hallId: 'qingyun', level: 'master', options: { sevenPairs: true, fourZhong: true, zhongDiscard: true } })).ok, '开始人机试炼（大师）')
assert(table!.phase === 'dice' && table!.dice![0].rolls.length === 4, '掷骰定庄：四人各掷一次')
assert(!(await send({ op: 'quick', hallId: 'qingyun', botLevel: 'easy' })).ok, '在麻将桌上不能同时开扑克局')

const started = Date.now()
let acted = 0
while (table && (table as MjView).phase !== 'over') {
  const view = table as MjView
  const actor = view.phase === 'claim' ? view.claimSeat : view.turn
  if (view.phase !== 'dice' && actor === 0) {
    const c = view.choices
    const action = view.phase === 'claim' ? (c.kong ? { type: 'kong' } : { type: 'pass' })
      : c.hu ? { type: 'hu' } : c.ankan.length ? { type: 'ankan', kind: c.ankan[0] } : { type: 'discard', tile: view.drawn ?? c.discards[0] }
    const before = view.seq
    const reply = await send({ op: 'mj:act', action })
    if (!reply.ok) { console.error('✗ 操作被拒绝', reply.error, action); process.exit(1) }
    acted += 1
    for (let i = 0; i < 100 && table && (table as MjView).seq === before; i += 1) await new Promise((resolve) => setTimeout(resolve, 20))
  } else {
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  if (Date.now() - started > 240000) { console.error('✗ 超时'); process.exit(1) }
}
const over = table as unknown as MjView
assert(acted > 3, `我出了 ${acted} 手，用时 ${Math.round((Date.now() - started) / 1000)} 秒`)
assert(over.seats.reduce((sum, seat) => sum + seat.score, 0) === 0, `分数零和（${over.seats.map((seat) => seat.score).join(' / ')}）`)
const result = over.result!
if (result.winner >= 0) {
  const pip = ((result.bird >> 2) % 9) + 1
  const expected = (result.bird >> 2) === 27 || pip === 1 || pip === 9 ? 10 : pip + 1
  assert(result.birdScore === expected && result.perPlayer === expected * (result.shaGui ? 2 : 1), `座位 ${result.winner} 自摸${result.shaGui ? '（杀鬼翻倍）' : ''}，鸟 ${result.birdScore} 分，每家 ${result.perPlayer} 分`)
} else {
  assert(result.nextDealer === over.dealer, '流局，庄家连庄')
}
assert(over.settlement && over.settlement.coinsDelta === over.seats[0].score * 10, `金币结算 ${over.settlement?.coinsDelta}`)
const me = await (await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${guest.token}` } })).json() as { user: UserProfile }
assert(me.user.coins === guest.user.coins + over.settlement!.coinsDelta && me.user.games === 1, `金币已入账（${me.user.coins}）`)
const match = await (await fetch(`${base}/api/mahjong/match?id=${over.settlement!.matchId}`, { headers: { Authorization: `Bearer ${guest.token}` } })).json() as any
assert(match.record?.events?.length > 4, '牌谱已保存，可供复盘')

// AI 设置：保存、掩码、未配 Key 时的报错
const noKey = await post('/api/mahjong/review', { matchId: over.settlement!.matchId, analysis: '测试'.repeat(20) }, guest.token)
assert(/API Key/.test(noKey.error || ''), '未设置 Key 时提示去填写')
const saved = await post('/api/me/ai', { apiKey: 'sk-e2e-not-a-real-key-000000', model: 'deepseek-chat' }, guest.token)
assert(saved.user?.aiKeyMask === 'sk-e2****0000' && !JSON.stringify(saved).includes('not-a-real'), 'API Key 加密保存，只回显掩码')
const bad = await post('/api/me/ai/test', {}, guest.token)
assert(/无效|失败|错误/.test(bad.error || ''), `假 Key 调 DeepSeek 被正确拒绝（${bad.error}）`)
await post('/api/me/ai', { apiKey: '' }, guest.token)

assert((await send({ op: 'mj:next' })).ok && (table as unknown as MjView).handNo === 2 && (table as unknown as MjView).dealer === result.nextDealer, '下一局：换庄正确，不再掷骰')
await send({ op: 'mj:leave' })
console.log('\n红中麻将端到端测试全部通过')
process.exit(0)

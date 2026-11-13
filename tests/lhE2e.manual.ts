// 六胡抢端到端测试：对着运行中的服务器，一名游客 + 3 个机器人打完一整局。
// 用法：node --import tsx tests/lhE2e.manual.ts [http://localhost:8787]
import WebSocket from 'ws'
import type { LhView } from '../src/shared/liuhu/view.ts'
import type { ServerEvent, UserProfile } from '../src/shared/protocol.ts'

const base = process.argv[2] || 'http://localhost:8787'
const assert = (cond: unknown, message: string) => { if (!cond) { console.error('✗', message); process.exit(1) } else console.log('✓', message) }
const post = async (path: string, body: unknown) =>
  (await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>

let guest = await post('/api/auth/guest', {}) as { token: string; user: UserProfile }
// 游客次数用完时改用一次性的测试账号
if (!guest.token) guest = await post('/api/auth/register', { username: `e2e_${Math.random().toString(36).slice(2, 10)}`, password: Math.random().toString(36).slice(2) + 'Aa1' })
assert(guest.token, '登录（游客或一次性测试账号）')
const ws = new WebSocket(base.replace('http', 'ws') + '/ws')
let table: LhView | null = null
let seq = 0
const waiters = new Map<number, (event: any) => void>()
const send = (op: Record<string, unknown>) => new Promise<any>((resolve) => { seq += 1; waiters.set(seq, resolve); ws.send(JSON.stringify({ ...op, id: seq })) })
ws.on('message', (raw) => {
  const event = JSON.parse(raw.toString()) as ServerEvent
  if (event.ev === 'res') waiters.get(event.id)?.(event)
  if (event.ev === 'lh') table = event.table
})
await new Promise<void>((resolve) => ws.on('open', () => resolve()))
assert((await send({ op: 'auth', token: guest.token })).ok, '连接认证')
assert((await send({ op: 'lh:start', hallId: 'qingyun', level: 'master' })).ok, '开始六胡抢人机试炼（大师）')
assert(table!.phase === 'flip' && table!.flip![0].tiles.length === 4, '翻牌定庄：四人各翻一张')
assert(!(await send({ op: 'mj:start', hallId: 'qingyun', level: 'easy', options: {} })).ok, '在六胡抢桌上不能同时开麻将局')

const started = Date.now()
let acted = 0
while (table && (table as LhView).phase !== 'over') {
  const view = table as LhView
  if ((view.phase === 'discard' || view.phase === 'claim') && view.actor === 0) {
    const c = view.choices
    const action = c.hu ? { type: 'hu' } : c.discards.length ? { type: 'discard', tile: c.discards[c.discards.length - 1] } : c.peng ? { type: 'peng' } : c.chi.length ? { type: 'chi', option: 0 } : { type: 'pass' }
    const before = view.seq
    const reply = await send({ op: 'lh:act', action })
    if (!reply.ok) { console.error('✗ 操作被拒绝', reply.error, action); process.exit(1) }
    acted += 1
    for (let i = 0; i < 100 && table && (table as LhView).seq === before; i += 1) await new Promise((resolve) => setTimeout(resolve, 20))
  } else {
    await new Promise((resolve) => setTimeout(resolve, 60))
  }
  if (Date.now() - started > 240000) { console.error('✗ 超时'); process.exit(1) }
}
const over = table as unknown as LhView
assert(acted > 0, `我操作了 ${acted} 次，用时 ${Math.round((Date.now() - started) / 1000)} 秒`)
assert(over.seats.reduce((sum, seat) => sum + seat.score, 0) === 0, `分数零和（${over.seats.map((seat) => seat.score).join(' / ')}）`)
const result = over.result!
if (result.winner >= 0) assert(result.hu >= 6 && result.deltas[result.winner] === result.share * 3, `座位 ${result.winner} ${result.kind}，${result.hu} 胡 · ${result.redName} · 每份 ${result.share}`)
else assert(result.nextDealer === over.dealer, '荒庄，庄家连庄')
assert(over.settlement, `金币结算 ${over.settlement?.coinsDelta}`)
const me = await (await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${guest.token}` } })).json() as { user: UserProfile }
assert(me.user.coins === guest.user.coins + over.settlement!.coinsDelta && me.user.games === 1, `金币已入账（${me.user.coins}）`)
assert(over.record && over.record.decisions.length === acted && over.record.decisions.every((item) => item.seat === 0), `牌谱记下了我的 ${over.record?.decisions.length} 次决定`)
const noKey = await (await fetch(`${base}/api/mahjong/review`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guest.token}` }, body: JSON.stringify({ matchId: over.settlement!.matchId, analysis: '六胡抢复盘测试'.repeat(5) }) })).json() as any
assert(/API Key/.test(noKey.error || ''), '复盘接口认得六胡抢的牌局（未设置 Key 时提示去填写）')
assert((await send({ op: 'lh:next' })).ok && (table as unknown as LhView).handNo === 2 && (table as unknown as LhView).dealer === result.nextDealer, '下一局：换庄正确，不再翻牌')
await send({ op: 'lh:leave' })
console.log('\n六胡抢端到端测试全部通过')
process.exit(0)

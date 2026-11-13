// AI 教练：调用 DeepSeek（OpenAI 兼容接口）为一局牌写复盘点评。
// API Key 由每位用户在个人设置里自己填写，服务端用 AES-GCM 加密后保存，只回显掩码。
import { AppError } from './accounts.ts'

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
export const AI_MODELS = ['deepseek-chat', 'deepseek-reasoner']
export const DEFAULT_AI_MODEL = 'deepseek-chat'

const encoder = new TextEncoder()
const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'))

async function cryptoKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`daieryou-royale:${secret}`))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptSecret(plain: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(secret), encoder.encode(plain))
  return `${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`
}

export async function decryptSecret(stored: string, secret: string): Promise<string> {
  const [iv, cipher] = stored.split('.')
  if (!iv || !cipher) throw new AppError('保存的 API Key 已损坏，请重新填写')
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await cryptoKey(secret), fromBase64(cipher))
    return new TextDecoder().decode(plain)
  } catch {
    throw new AppError('保存的 API Key 无法解密，请重新填写')
  }
}

export function maskKey(key: string): string {
  return key.length <= 10 ? `${key.slice(0, 2)}****` : `${key.slice(0, 5)}****${key.slice(-4)}`
}

const COACH_PROMPT = `你是一位红中麻将教练，正在帮一位想提高水平的玩家复盘刚打完的一局。

这桌的规则（务必按此点评，不要套用其他麻将规则）：
- 112 张牌：万、条、筒 + 4 张红中。红中是癞子，可当任意牌。不能吃，可以碰、杠。
- 只能自摸胡，没有点炮，没有抢杠胡。所以不存在"防守""安全牌"的概念，打牌只看牌效（进张多、成牌快）。
- 杠当场结算：补杠三家各 1 分，放杠由放杠者付 3 分，暗杠三家各 2 分。
- 胡牌后抓 1 只鸟：一点、九点、红中 = 10 分，其余 = 点数 + 1，三家各付。
- 杀鬼：胡牌时手里没有红中，分数翻倍。

你会收到程序算好的客观数据：玩家每一次出牌时的向听数、进张数，以及当时进张最多的打法。请只依据这些数据点评，不要自己推算牌型，也不要编造数据里没有的牌。

请用简体中文写一份复盘，口吻像坐在旁边的老牌友，直接、具体，不说空话：
1. 先用两三句话给这一局定性（打得怎样、输赢主要是牌运还是打法）。
2. 挑出最值得改的 2~3 手，每手说明：当时打了什么、更好的打法是什么、为什么（差了多少进张、少等了哪些牌）。
3. 点评碰、杠的取舍（如果有）。
4. 最后给 2 条下一局就能用上的具体建议。
全文控制在 400 字以内，不要用表格，不要重复规则。`

export interface AiReply {
  text: string
  model: string
}

async function callDeepSeek(apiKey: string, model: string, messages: { role: string; content: string }[], maxTokens: number): Promise<AiReply> {
  let response: Response
  try {
    response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.6, stream: false }),
      signal: AbortSignal.timeout(90000),
    })
  } catch {
    throw new AppError('连接 DeepSeek 超时或失败，请稍后再试', 502)
  }
  if (response.status === 401) throw new AppError('DeepSeek API Key 无效，请到「个人设置 · AI 教练」重新填写', 400)
  if (response.status === 402) throw new AppError('DeepSeek 账户余额不足，请充值后再试', 400)
  if (response.status === 429) throw new AppError('DeepSeek 请求过于频繁，请稍后再试', 429)
  if (!response.ok) throw new AppError(`DeepSeek 返回错误（${response.status}），请稍后再试`, 502)
  const data = (await response.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null
  const text = data?.choices?.[0]?.message?.content?.trim()
  if (!text) throw new AppError('DeepSeek 没有返回内容，请重试', 502)
  return { text, model }
}

/** 根据客户端引擎算出的牌效数据，请 AI 写复盘 */
export function coachReview(apiKey: string, model: string, analysis: string): Promise<AiReply> {
  return callDeepSeek(apiKey, model, [
    { role: 'system', content: COACH_PROMPT },
    { role: 'user', content: analysis },
  ], 1200)
}

/** 保存 Key 时的连通性测试 */
export function pingModel(apiKey: string, model: string): Promise<AiReply> {
  return callDeepSeek(apiKey, model, [{ role: 'user', content: '请只回复两个字：可用' }], 16)
}

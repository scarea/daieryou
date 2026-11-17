// 生成报牌语音：用 macOS 自带的中文语音把每张牌、每个动作念一遍，存成小段 mp3。
// 用法（需要 macOS 和 ffmpeg）：npx tsx scripts/gen-voice.ts
// 想换成真人录音：按 src/client/voiceClips.ts 里的编号，把同名 mp3 放进 public/audio/voice/ 即可。
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { KIND_COUNT, kindName } from '../src/shared/mahjong/tiles.ts'

const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const lines: string[] = []
for (let kind = 0; kind < KIND_COUNT; kind += 1) lines.push(kindName(kind))
for (const size of ['小', '大']) for (const num of NUM) lines.push(`${size}${num}`)
lines.push('碰', '杠', '吃', '笑', '提', '跑', '重跑', '自摸', '胡了', '杀鬼，自摸', '流局', '荒庄', '语音已开启')
// 新增的句子只往后加，前面的编号不变
lines.push('放炮', '抢胡')

const dir = 'public/audio/voice'
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const map: Record<string, string> = {}
lines.forEach((text, index) => {
  const id = `v${String(index).padStart(2, '0')}`
  const raw = `${dir}/${id}.aiff`
  // 多音字按牌桌上的读法念：重跑的「重」读 chóng
  const speech = text === '重跑' ? '虫跑' : text
  execFileSync('say', ['-v', 'Tingting', '-r', '210', '-o', raw, speech])
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,volume=1.6', '-ac', '1', '-ar', '24000', '-b:a', '40k', `${dir}/${id}.mp3`])
  rmSync(raw)
  map[text] = id
})
writeFileSync('src/client/voiceClips.ts', `// 由 scripts/gen-voice.ts 生成：报牌文字 → public/audio/voice/ 下的文件名\nexport const VOICE_CLIPS: Record<string, string> = ${JSON.stringify(map, null, 2)}\n`)
console.log(`生成 ${lines.length} 段语音`)

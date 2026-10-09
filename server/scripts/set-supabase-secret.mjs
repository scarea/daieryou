#!/usr/bin/env node
// 把 Supabase 数据库安全地接入 Cloudflare：
// 1. 隐藏输入数据库密码（不回显、不落盘、不进 shell 历史）
// 2. 用 Supabase 根证书校验 TLS，实际连接一次，确认密码正确
// 3. 创建 Cloudflare Hyperdrive 配置（verify-ca 模式，校验 Supabase 私有 CA），输出 Hyperdrive ID
//
// 为什么用 Hyperdrive：Supabase 连接池的证书由 Supabase 私有 CA 签发，Workers 直连时无法跳过/自定义证书校验，
// Hyperdrive 支持上传自定义 CA 并以 verify-ca 方式连接。
//
// 用法：node scripts/set-supabase-secret.mjs <项目ref> <pooler主机> <Cloudflare CA证书ID> [Hyperdrive名称]
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const [projectRef, poolerHost, caCertificateId, hyperdriveName = 'daieryou-db'] = process.argv.slice(2)
if (!projectRef || !poolerHost || !caCertificateId) {
  console.error('用法：node scripts/set-supabase-secret.mjs <项目ref> <pooler主机> <Cloudflare CA证书ID> [Hyperdrive名称]')
  process.exit(1)
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const supabaseRootCa = fs.readFileSync(path.join(scriptDir, '../../supabase/supabase-root-2021-ca.pem'), 'utf8')

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (text) => {
      if (text.startsWith(question)) {
        rl.output.write(question)
      }
    }
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer.trim())
    })
  })
}

function runWrangler(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', ...args], { stdio: ['ignore', 'pipe', 'inherit'] })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
      process.stdout.write(chunk)
    })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve(output) : reject(new Error(`wrangler 退出码 ${code}`))))
  })
}

const password = await askHidden('粘贴 Supabase 数据库密码（输入不会显示），然后回车：')
if (!password) {
  console.error('未输入密码，已取消。')
  process.exit(1)
}

const user = `postgres.${projectRef}`
console.log('正在测试数据库连接（校验 Supabase 证书）…')
const client = new pg.Client({
  host: poolerHost,
  port: 5432,
  user,
  password,
  database: 'postgres',
  ssl: { ca: supabaseRootCa, servername: poolerHost },
  connectionTimeoutMillis: 10000,
})
try {
  await client.connect()
  await client.query('select 1')
  await client.end()
  console.log('✓ 数据库连接成功')
} catch (error) {
  console.error('✗ 数据库连接失败：', error.message)
  console.error('请确认密码是 Supabase 里最新重置/生成的那个，然后重新运行本命令。')
  process.exit(1)
}

const connectionString = `postgresql://${user}:${encodeURIComponent(password)}@${poolerHost}:5432/postgres`
console.log(`正在创建 Cloudflare Hyperdrive 配置 ${hyperdriveName}…`)
const output = await runWrangler([
  'hyperdrive', 'create', hyperdriveName,
  `--connection-string=${connectionString}`,
  '--ca-certificate-id', caCertificateId,
  '--sslmode', 'verify-ca',
])
const id = output.match(/"id":\s*"([0-9a-f]{32})"/)?.[1] || output.match(/\b([0-9a-f]{32})\b/)?.[1]
console.log(id ? `\n✓ 完成。Hyperdrive ID：${id}` : '\n✓ 完成。请把上面输出中的 Hyperdrive ID 告诉 Claude。')

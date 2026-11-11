// 一条命令同时启动游戏服务器与前端开发服务器
import { spawn } from 'node:child_process'

const serverPort = process.env.SERVER_PORT || '8787'
const env = { ...process.env, SERVER_PORT: serverPort }
const bin = (name) => `node_modules/.bin/${name}`

const procs = [
  spawn(bin('tsx'), ['watch', 'src/server/main.ts'], { stdio: 'inherit', env }),
  spawn(bin('vite'), [], { stdio: 'inherit', env }),
]

const stop = () => procs.forEach((p) => p.kill('SIGTERM'))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
procs.forEach((p) => p.on('exit', (code) => { stop(); process.exit(code ?? 0) }))

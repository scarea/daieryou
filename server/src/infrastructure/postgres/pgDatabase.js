const { Pool } = require('pg')
const SCHEMA_SQL = require('./schemaSql')

/**
 * Postgres 连接池（用于 Supabase 等托管 Postgres）。
 * - 连接串来自 DAIERYOU_DATABASE_URL
 * - 默认启用 TLS（Supabase 要求），可用 DAIERYOU_DATABASE_SSL=disable 关闭（本地开发/测试）
 */
class PgDatabase {
  constructor({ connectionString, ssl = 'require', max = 5, logger = console }) {
    this.connectionString = connectionString
    this.logger = logger
    this.ready = false
    this.pool = new Pool({
      connectionString,
      max,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: ssl === 'disable' ? false : { rejectUnauthorized: false },
    })
    // 连接池里的空闲连接出错（例如数据库重启）时不让进程崩溃
    this.pool.on('error', (error) => {
      this.logger.error('Postgres 连接池错误:', error.message)
    })
  }

  async connect({ migrate = true } = {}) {
    await this.pool.query('select 1')
    if (migrate) {
      await this.pool.query(SCHEMA_SQL)
    }
    this.ready = true
  }

  isReady() {
    return this.ready
  }

  query(text, params) {
    return this.pool.query(text, params)
  }

  // 事务：回调里拿到同一个连接
  async transaction(callback) {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const result = await callback(client)
      await client.query('commit')
      return result
    } catch (error) {
      await client.query('rollback').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  async heartbeat(service = 'game-server', detail = {}) {
    await this.pool.query(
      `insert into service_heartbeats (service, beat_at, detail)
       values ($1, $2, $3::jsonb)
       on conflict (service) do update set beat_at = excluded.beat_at, detail = excluded.detail`,
      [service, Date.now(), JSON.stringify(detail)],
    )
  }

  async close() {
    this.ready = false
    await this.pool.end()
  }
}

module.exports = { PgDatabase }

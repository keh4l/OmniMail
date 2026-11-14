import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

// 仅供单元测试使用：在 node:sqlite 上执行全部真实迁移并模拟 D1 接口，让查询直接覆盖当前表结构。
// D1 特有的限制（如复合 SELECT 项数）测不出来，需要时另写 workerd 集成测试。

export type SqliteRow = Record<string, string | number | null>

export function migratedDatabase(options: { skip?: string } = {}): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  const names = readdirSync('migrations').filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort()
  for (const name of names) if (name !== options.skip) db.exec(readFileSync(`migrations/${name}`, 'utf8'))
  return db
}

export function d1(db: DatabaseSync) {
  const statement = (sql: string, params: Array<string | number | null> = []) => ({
    sql,
    params,
    bind: (...values: Array<string | number | null>) => statement(sql, values),
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    first: async () => db.prepare(sql).get(...params) ?? null,
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...params).changes) } }),
  })
  return {
    prepare: (sql: string) => statement(sql),
    async batch(statements: Array<ReturnType<typeof statement>>) {
      db.exec('BEGIN')
      try {
        const results = statements.map(({ sql, params }) => ({ results: db.prepare(sql).all(...params) }))
        db.exec('COMMIT')
        return results
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}

// 按表结构自动补齐必填列，测试只需声明关心的字段。
export function insert(db: DatabaseSync, table: string, values: SqliteRow): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string; type: string; notnull: number; dflt_value: string | null; pk: number
  }>
  const row: SqliteRow = { ...values }
  for (const column of columns) {
    if (column.name in row || !column.notnull || column.dflt_value !== null) continue
    row[column.name] = /INT/i.test(column.type) ? 0 : `${column.name}-${crypto.randomUUID()}`
  }
  const names = Object.keys(row)
  db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
    .run(...names.map((name) => row[name]))
}

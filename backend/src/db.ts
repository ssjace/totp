import { Pool, QueryResult, QueryResultRow } from "pg";

// A single Pool is shared across the process. Pool manages a set of
// persistent connections to Postgres and hands them out on demand,
// returning them automatically when a query finishes.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Thin wrapper so call sites never touch the pool directly.
// Generic R lets callers type the expected row shape:
//   const { rows } = await query<{ id: number }>("SELECT id FROM users")
export async function query<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<QueryResult<R>> {
  return pool.query<R>(sql, params);
}

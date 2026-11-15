import { DatabaseSync } from 'node:sqlite';

// Exercise production D1 statements against a real, shared SQLite database.
// A D1 batch is transactional, including its read/modify/write statements.
export function openReviewDatabase(file) {
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=15000;');
  const DB = {
    prepare(sql) {
      const statement = (args = []) => ({
        bind(...values) { return statement(values); },
        async run() {
          const results = sqlite.prepare(sql).all(...args);
          const { changes } = sqlite.prepare('SELECT changes() AS changes').get();
          return { success: true, results, meta: { changes } };
        },
        async first() { return sqlite.prepare(sql).get(...args) ?? null; },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...args) }; },
      });
      return statement();
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, DB };
}

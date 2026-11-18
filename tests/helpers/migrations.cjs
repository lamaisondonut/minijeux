'use strict';
const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve(__dirname, '../../migrations');
const migrationFiles = fs.readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort();
const migrationSql = migrationFiles.map(name => fs.readFileSync(path.join(directory, name), 'utf8'));

function splitMigration(sql) {
  const triggers = [];
  // Keep trigger-internal semicolons in one D1 prepared statement. All checked
  // migrations use complete CREATE TRIGGER ... END; blocks on separate lines.
  const flattened = sql.replace(/^\s*--[^\n]*(?:\n|$)/gm, '').replace(/CREATE TRIGGER\b[\s\S]*?^END;/gm, trigger => `__TRIGGER_${triggers.push(trigger) - 1}__;`);
  return flattened.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const match = /^__TRIGGER_(\d+)__$/.exec(part);
    return match ? triggers[Number(match[1])] : part;
  });
}

async function migrateD1(DB) {
  for (const sql of migrationSql) await DB.batch(splitMigration(sql).map(statement => DB.prepare(statement)));
}

function migrateSqlite(sqlite, { before } = {}) {
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (let index = 0; index < migrationSql.length; index++) {
    if (before && migrationFiles[index] >= before) break;
    const sql = migrationSql[index];
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.exec(sql);
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

module.exports = { migrationFiles, migrationSql, splitMigration, migrateD1, migrateSqlite };

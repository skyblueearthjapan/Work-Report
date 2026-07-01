'use strict';
/** SQLite 接続と初期化（データは data/worklog.db に永続） */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'worklog.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS cases (
    id        TEXT PRIMARY KEY,
    type      TEXT,
    archived  INTEGER DEFAULT 0,
    koban     TEXT,
    updatedAt TEXT,
    closedAt  TEXT,
    data      TEXT           -- 案件オブジェクト全体（ネスト・署名等含む）を JSON で保持
  );
  CREATE INDEX IF NOT EXISTS idx_cases_archived ON cases(archived);
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT           -- マスターミラー等の付帯データを JSON で保持
  );
`);

module.exports = db;

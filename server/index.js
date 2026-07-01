'use strict';
/**
 * デジタル作業報告書アプリ（VPS版） — Express エントリ
 * V1: 静的フロント配信 ＋ /api/health の疎通確認のみ。
 *     以降のフェーズで REST API・SQLite・Drive・Gemini・Google ログインを追加する。
 */
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 5174;

app.use(express.json({ limit: '25mb' })); // 署名・音声・PDF等の受け渡しを見越して大きめ

// ヘルスチェック（Funnel/内部疎通の確認に使用）
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'lineworks-worklog',
    version: require('../package.json').version,
    time: new Date().toISOString()
  });
});

// 静的フロント
const WEB_DIR = path.join(__dirname, '..', 'web');
app.use(express.static(WEB_DIR));

// SPA フォールバック（API以外は index.html）
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('[worklog] listening on http://0.0.0.0:' + PORT);
});

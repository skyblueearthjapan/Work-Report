'use strict';
/**
 * デジタル作業報告書アプリ（VPS版） — Express エントリ
 * V2: SQLite ＋ REST API（案件CRUD・履歴検索・設定）。
 *     Drive/メール/Gemini/Googleログインは後続フェーズで追加。
 */
const path = require('path');
const express = require('express');
const store = require('./store');

const app = express();
const PORT = process.env.PORT || 5174;

app.use(express.json({ limit: '30mb' })); // 署名dataURL・音声・PDFの受け渡しを見越して

// 初回起動時、案件が空ならサンプル投入
try {
  const seeded = store.seedSampleDataIfEmpty();
  if (seeded) console.log('[worklog] seeded sample cases:', seeded);
} catch (e) { console.error('[worklog] seed error', e); }

// ---- API 共通ラッパ（例外を JSON エラーに） ----
function h(fn) {
  return (req, res) => {
    try { const out = fn(req, res); res.json(out === undefined ? { ok: true } : out); }
    catch (e) { console.error(e); res.status(400).json({ error: (e && e.message) || String(e) }); }
  };
}

app.get('/api/health', h(() => ({ ok: true, app: 'lineworks-worklog', version: require('../package.json').version, time: new Date().toISOString() })));

// 起動データ（案件一覧＋履歴件数＋設定）
app.get('/api/state', h(() => {
  const st = store.getAppState();
  return { cases: st.cases, historyCount: st.historyCount, settings: store.getSettings(), today: require('./util').todayStr() };
}));

// フロント起動用の全初期データ（BOOT）
app.get('/api/boot', h(() => {
  const st = store.getAppState();
  const settings = store.getSettings();
  return {
    cases: st.cases,
    historyCount: st.historyCount,
    settings: settings,
    company: { companyLW: settings.companyLW || 'LINE W', companyTS: settings.companyTS || 'テクノサービス' },
    master: (typeof store.getMasterData === 'function' ? store.getMasterData() : { kobans: [], staff: [], depts: [], importedAt: '' }),
    geminiEnabled: !!process.env.GEMINI_API_KEY,
    folderUrl: '',
    today: require('./util').todayStr()
  };
}));

// 署名保存（V2: SQLiteにインライン保持。V3でDriveにも保管）
app.post('/api/cases/:id/signature', h(req => {
  const dataUrl = (req.body && req.body.dataUrl) || '';
  store.saveCase({ id: req.params.id, signature: dataUrl });
  return { url: dataUrl, fileId: '' };
}));

// PDFバックアップ（V2: no-op。V3でGAS経由Driveへ保管）
app.post('/api/cases/:id/pdf', h(() => ({ ok: true, note: 'V3でDrive保管に接続' })));

// メール送信（V3でGAS経由Gmailに接続）
app.post('/api/cases/:id/mail', h(() => { throw new Error('メール送信はV3で有効化されます'); }));

// 案件
app.get('/api/cases/:id', h(req => store.getCase(req.params.id)));
app.post('/api/cases', h(req => ({ id: store.saveCase(req.body) })));
app.post('/api/cases/:id/duplicate', h(req => ({ id: store.duplicateCase(req.params.id) })));
app.delete('/api/cases/:id', h(req => ({ ok: store.deleteCase(req.params.id) })));
app.post('/api/cases/:id/close', h(req => ({ ok: store.closeCase(req.params.id) })));
app.post('/api/cases/:id/stamp', h(req => ({ ok: store.stampKanin(req.params.id, (req.body && req.body.name) || '') })));

// 履歴
app.get('/api/history', h(req => store.getHistory(req.query.q || '', req.query.type || 'all')));

// 設定
app.get('/api/settings', h(() => store.getSettings()));
app.post('/api/settings', h(req => store.saveSettings(req.body)));

// ---- 静的フロント ----
const WEB_DIR = path.join(__dirname, '..', 'web');
app.use(express.static(WEB_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => console.log('[worklog] listening on http://0.0.0.0:' + PORT));

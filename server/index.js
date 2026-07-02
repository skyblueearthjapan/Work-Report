'use strict';
/**
 * デジタル作業報告書アプリ（VPS版） — Express エントリ
 * V2: SQLite ＋ REST API（案件CRUD・履歴検索・設定）。
 *     Drive/メール/Gemini/Googleログインは後続フェーズで追加。
 */
const path = require('path');
const express = require('express');
const store = require('./store');
const { gasCall, gasConfigured } = require('./gas');
const ai = require('./ai');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 5174;
app.set('trust proxy', true); // Funnel/リバースプロキシ背後

// 認証を body parser より前に。未認証リクエストで巨大bodyをparseしない（DoS対策）。
// /auth/* と /api/me は body 不要なのでこの順で問題ない。
auth.install(app);
app.use(auth.middleware());

app.use(express.json({ limit: '30mb' })); // 署名dataURL・音声・PDFの受け渡しを見越して（認証後のみ）

// クライアント入力からサーバー管理フィールドを除去（Drive fileId等の注入を防止）
function sanitizeClientCase(b) {
  if (!b || typeof b !== 'object') return {};
  const o = Object.assign({}, b);
  ['signatureFileId', 'pdfFileId', 'driveFolderId', 'createdAt', 'updatedAt'].forEach(k => { delete o[k]; });
  return o;
}

// GAS 委譲に渡す案件メタ（フォルダ名/ファイル名生成に必要な最小限）
function caseMeta(c) {
  return { koban: c.koban || '', nohinSaki: c.nohinSaki || '', yoteibi: c.yoteibi || '', closedAt: c.closedAt || '', kishu: c.kishu || '', driveFolderId: c.driveFolderId || '' };
}
function normalizeRecipients(s) {
  return String(s || '').split(/[,;\s]+/).map(x => x.trim()).filter(x => x && x.indexOf('@') !== -1).join(',');
}
function pdfBaseName(c) {
  const safe = x => String(x || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  const d = c.yoteibi || c.closedAt || require('./util').todayStr();
  return ['作業報告書', safe(c.nohinSaki), safe(c.kishu), safe(c.koban), safe(d)].filter(Boolean).join('_');
}
// 非同期ハンドラ（GAS呼び出し用）
function ha(fn) {
  return async (req, res) => {
    try { const out = await fn(req, res); res.json(out === undefined ? { ok: true } : out); }
    catch (e) { console.error(e); res.status(400).json({ error: (e && e.message) || String(e) }); }
  };
}

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
    master: store.getMaster(),
    geminiEnabled: !!process.env.GEMINI_API_KEY,
    folderUrl: process.env.DRIVE_FOLDER_URL || '',
    today: require('./util').todayStr()
  };
}));

// 署名保存（GAS経由でDrive案件フォルダへ。未設定時はSQLiteインラインのみ）
app.post('/api/cases/:id/signature', ha(async req => {
  const id = req.params.id;
  const dataUrl = (req.body && req.body.dataUrl) || '';
  const c = store.getCase(id);
  if (!c) throw new Error('案件が見つかりません: ' + id);
  if (gasConfigured()) {
    const r = await gasCall('saveSignature', { meta: caseMeta(c), dataUrl });
    store.saveCase({ id, signature: dataUrl, signatureFileId: r.fileId, driveFolderId: r.folderId });
    return { url: dataUrl, fileId: r.fileId };
  }
  store.saveCase({ id, signature: dataUrl });
  return { url: dataUrl, fileId: '' };
}));

// PDFバックアップ（クローズ時。GAS経由でDrive案件フォルダへ保管）
app.post('/api/cases/:id/pdf', ha(async req => {
  const id = req.params.id;
  const pdfBase64 = (req.body && req.body.pdfBase64) || '';
  const c = store.getCase(id);
  if (!c) throw new Error('案件が見つかりません: ' + id);
  if (gasConfigured() && pdfBase64) {
    const r = await gasCall('saveReportPdf', { meta: caseMeta(c), pdfBase64 });
    store.saveCase({ id, pdfFileId: r.fileId, driveFolderId: r.folderId });
    return { ok: true, fileId: r.fileId };
  }
  return { ok: true, note: gasConfigured() ? 'no pdf data' : 'GAS未設定のためスキップ' };
}));

// メール送信（GAS経由 Gmail。保管PDFを添付、設定の宛先TO/CCへ）
app.post('/api/cases/:id/mail', ha(async req => {
  const id = req.params.id;
  const c = store.getCase(id);
  if (!c) throw new Error('案件が見つかりません: ' + id);
  if (!gasConfigured()) throw new Error('メール送信はGAS連携設定後に有効になります');
  if (!c.pdfFileId) throw new Error('PDFが未生成のため送信できません');
  const s = store.getSettings();
  const to = normalizeRecipients(s.email);
  const cc = normalizeRecipients(s.cc);
  if (!to) throw new Error('送信先(TO)が未設定です');
  const subject = store.fillTemplate(s.subject, c) || ('作業報告書 ' + (c.koban || ''));
  const body = store.fillTemplate(s.body, c);
  await gasCall('sendMail', { to, cc, subject, body, pdfFileId: c.pdfFileId, fileName: pdfBaseName(c) + '.pdf' });
  store.saveCase({ id, status: c.status === 'クローズ' ? c.status : '完了' });
  return { ok: true, to, cc };
}));

// AI（Gemini）: 音声文字起こし・処置整形・銘板OCR
app.post('/api/ai/transcribe', ha(async req => ({ text: await ai.transcribe((req.body && req.body.audio) || '', (req.body && req.body.mime) || 'audio/webm', (req.body && req.body.style) || 'auto') })));
app.post('/api/ai/format', ha(async req => ({ text: await ai.formatShori((req.body && req.body.text) || '', (req.body && req.body.style) || 'auto') })));
app.post('/api/ai/plate', ha(async req => await ai.readPlate((req.body && req.body.image) || '')));

// マスター取込（GAS経由で外部シート→SQLiteミラー）
app.post('/api/master/refresh', ha(async () => {
  if (!gasConfigured()) throw new Error('GAS連携が未設定です');
  const m = await gasCall('refreshMaster');
  const saved = store.setMaster(m);
  return {
    counts: { kobans: (m.kobans || []).length, staff: (m.staff || []).length, depts: (m.depts || []).length },
    importedAt: m.importedAt,
    master: saved
  };
}));

// 案件
app.get('/api/cases/:id', h(req => store.getCase(req.params.id)));
app.post('/api/cases', h(req => ({ id: store.saveCase(sanitizeClientCase(req.body)) })));
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

// 毎日 6:07(JST) に外部マスターを取り込み（GAS連携時のみ）
try {
  const cron = require('node-cron');
  cron.schedule('7 6 * * *', async () => {
    if (!gasConfigured()) return;
    try { const m = await gasCall('refreshMaster'); store.setMaster(m); console.log('[worklog] master refreshed (cron)'); }
    catch (e) { console.error('[worklog] master cron error', e); }
  }, { timezone: 'Asia/Tokyo' });
} catch (e) { console.error('[worklog] cron init skipped', e); }

app.listen(PORT, '0.0.0.0', () => console.log('[worklog] listening on http://0.0.0.0:' + PORT));

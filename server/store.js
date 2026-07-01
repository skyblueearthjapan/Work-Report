'use strict';
/**
 * 案件（cases）・設定（settings）のデータアクセス層（SQLite）。
 * GAS 版 Cases.js / Settings.js のロジックを踏襲。案件は JSON まるごと保持。
 */
const db = require('./db');
const { todayStr, nowStamp, newId } = require('./util');
const { sampleCases } = require('./sampleData');

/* ---------------- 設定 ---------------- */
function defaultSettings() {
  return {
    email: 'genba-report@line-works.co.jp',
    cc: '',
    travelDepts: '組立・塗装,機械設計,TSC',
    subject: '【作業報告書】{工番} {お客様名}',
    body: 'お疲れ様です。\n下記案件の作業報告書をお送りいたします。\n\n' +
      '■工番：{工番}\n■お客様：{お客様名} 様\n■作業日：{作業日}\n\n' +
      'PDFを添付いたしますのでご確認をお願いいたします。\n\n何卒よろしくお願い申し上げます。',
    companyLW: 'LINE W',
    companyTS: 'テクノサービス'
  };
}
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = {};
  rows.forEach(r => { map[r.key] = r.value; });
  const def = defaultSettings();
  const out = {};
  Object.keys(def).forEach(k => { out[k] = (k in map && map[k] !== '' && map[k] != null) ? String(map[k]) : def[k]; });
  // 既定に無いキーも返す
  Object.keys(map).forEach(k => { if (!(k in out)) out[k] = map[k]; });
  return out;
}
function saveSettings(obj) {
  if (!obj) return getSettings();
  const up = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const tx = db.transaction(o => { Object.keys(o).forEach(k => up.run(k, o[k] == null ? '' : String(o[k]))); });
  tx(obj);
  return getSettings();
}

/* ---------------- 案件 ---------------- */
const SERVER_MANAGED = { signatureFileId: 1, pdfFileId: 1, driveFolderId: 1 };

function defaultConfirm(type) {
  if (type === 'LW') return [
    { key: 'brake', label: 'ブレーキ調整スイッチOFF', value: '' },
    { key: 'rbpos', label: 'R/B+POSの作業原点復帰', value: '' },
    { key: 'force', label: '強制運転時からの復帰', value: '' }];
  return [
    { key: 'doukou', label: '動作確認', value: '' },
    { key: 'anzen', label: '安全確認', value: '' },
    { key: 'souji', label: '清掃・片付け', value: '' }];
}

function upsertCase(c) {
  db.prepare(`INSERT INTO cases(id,type,archived,koban,updatedAt,closedAt,data)
    VALUES(@id,@type,@archived,@koban,@updatedAt,@closedAt,@data)
    ON CONFLICT(id) DO UPDATE SET
      type=excluded.type, archived=excluded.archived, koban=excluded.koban,
      updatedAt=excluded.updatedAt, closedAt=excluded.closedAt, data=excluded.data`)
    .run({
      id: c.id, type: c.type || 'LW', archived: c.archived ? 1 : 0,
      koban: c.koban || '', updatedAt: c.updatedAt || '', closedAt: c.closedAt || '',
      data: JSON.stringify(c)
    });
}
function rowToCase(row) { const c = JSON.parse(row.data); c.archived = !!c.archived; return c; }

function getAppState() {
  const rows = db.prepare('SELECT data FROM cases').all();
  const cases = []; let historyCount = 0;
  rows.forEach(r => { const c = JSON.parse(r.data); if (c.archived) historyCount++; else cases.push(c); });
  cases.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return { cases, historyCount };
}
function getCases() { return getAppState().cases; }

function getHistory(query, type) {
  const rows = db.prepare('SELECT data FROM cases WHERE archived=1').all();
  const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const want = type || 'all';
  const out = [];
  rows.forEach(r => {
    const c = JSON.parse(r.data);
    if (want !== 'all' && c.type !== want) return;
    if (terms.length) {
      const hay = [c.koban, c.motoKoban, c.seiban, c.nohinSaki, c.okyakuSub, c.kishu, c.katashiki, c.kobanName, c.tantou, c.closedAt, c.yoteibi]
        .filter(Boolean).join(' ').toLowerCase();
      if (!terms.every(t => hay.indexOf(t) !== -1)) return;
    }
    out.push(c);
  });
  out.sort((a, b) => String(b.closedAt || '').localeCompare(String(a.closedAt || '')));
  return out;
}

function getCase(id) {
  const row = db.prepare('SELECT data FROM cases WHERE id=?').get(id);
  return row ? rowToCase(row) : null;
}

function mergeCase(base, incoming) {
  const out = Object.assign({}, base);
  Object.keys(incoming).forEach(k => {
    if (incoming[k] === undefined) return;
    if (SERVER_MANAGED[k] && !incoming[k]) return; // サーバー管理IDは空で上書きしない
    out[k] = incoming[k];
  });
  return out;
}

function saveCase(caseObj) {
  if (caseObj && caseObj.id) {
    const existing = getCase(caseObj.id);
    if (existing) {
      const merged = mergeCase(existing, caseObj);
      merged.updatedAt = nowStamp();
      merged.createdAt = existing.createdAt || nowStamp();
      upsertCase(merged);
      return merged.id;
    }
  }
  const nc = Object.assign({}, caseObj || {});
  nc.id = newId('c');
  nc.archived = !!nc.archived;
  nc.oshaName = nc.oshaName || nc.nohinSaki || '';
  nc.tantoushaName = nc.tantoushaName || (nc.staff && nc.staff[0] ? nc.staff[0].name : '');
  nc.createdAt = nowStamp();
  nc.updatedAt = nc.createdAt;
  upsertCase(nc);
  return nc.id;
}

function duplicateCase(id) {
  const c = getCase(id);
  if (!c) throw new Error('複製元が見つかりません: ' + id);
  const nc = JSON.parse(JSON.stringify(c));
  nc.id = newId('c');
  nc.koban = (c.koban || '') + '-複製';
  nc.status = '未着手';
  nc.archived = false;
  nc.closedAt = '';
  nc.signature = '';
  nc.signatureFileId = '';
  nc.pdfFileId = '';
  nc.driveFolderId = '';
  nc.kanin = { stamped: false, name: (c.kanin && c.kanin.name) || '' };
  nc.createdAt = nowStamp();
  nc.updatedAt = nc.createdAt;
  upsertCase(nc);
  return nc.id;
}

function deleteCase(id) {
  return db.prepare('DELETE FROM cases WHERE id=?').run(id).changes > 0;
}

function closeCase(id) {
  const c = getCase(id);
  if (!c) throw new Error('案件が見つかりません: ' + id);
  if (!(c.kanin && c.kanin.stamped)) throw new Error('確認印が押されていないためクローズできません。');
  c.archived = true;
  c.status = 'クローズ';
  c.closedAt = todayStr();
  c.updatedAt = nowStamp();
  upsertCase(c);
  return true;
}

function stampKanin(id, name) {
  const c = getCase(id);
  if (!c) throw new Error('案件が見つかりません: ' + id);
  c.kanin = { stamped: true, name: name || (c.kanin && c.kanin.name) || (c.type === 'LW' ? '製造部 田中' : 'TSC 木下') };
  c.updatedAt = nowStamp();
  upsertCase(c);
  return true;
}

/* ---------------- マスター（外部シートのミラー） ---------------- */
function getMaster() {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get('master');
  if (!row) return { kobans: [], staff: [], depts: [], importedAt: '' };
  try { return JSON.parse(row.value); } catch (e) { return { kobans: [], staff: [], depts: [], importedAt: '' }; }
}
function setMaster(obj) {
  const val = JSON.stringify(obj || { kobans: [], staff: [], depts: [], importedAt: nowStamp() });
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('master', val);
  return getMaster();
}

/* ---------------- メール差込 ---------------- */
function fmtDateJp(d) { if (!d) return ''; const p = String(d).split('-'); return p.length >= 2 ? p.join('/') : String(d); }
function fillTemplate(str, c) {
  if (!str) return '';
  return String(str).replace(/\{工番\}/g, (c && c.koban) || '').replace(/\{お客様名\}/g, (c && c.nohinSaki) || '').replace(/\{作業日\}/g, (c && fmtDateJp(c.yoteibi)) || '');
}

/* ---------------- 初期データ ---------------- */
function seedSampleDataIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) c FROM cases').get().c;
  if (n > 0) return 0;
  const list = sampleCases(defaultConfirm);
  const tx = db.transaction(arr => arr.forEach(upsertCase));
  tx(list);
  return list.length;
}

module.exports = {
  defaultSettings, getSettings, saveSettings, defaultConfirm,
  getAppState, getCases, getHistory, getCase, saveCase, duplicateCase, deleteCase, closeCase, stampKanin,
  getMaster, setMaster, fillTemplate,
  seedSampleDataIfEmpty
};

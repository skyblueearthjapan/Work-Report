'use strict';
/**
 * 会社「作業報告書」GAS（doPost トークンAPI）へのサーバー間クライアント。
 * Drive保管・メール送信・マスター取込を GAS（会社アカウント実行）へ委譲する。
 * 設定: 環境変数 GAS_API_URL（/exec） / GAS_API_TOKEN
 */
const GAS_URL = process.env.GAS_API_URL || '';
const GAS_TOKEN = process.env.GAS_API_TOKEN || '';

function gasConfigured() { return !!(GAS_URL && GAS_TOKEN); }
// 送信先は GAS の /exec のみ許可（トークンを誤送信しないため）
const GAS_URL_OK = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(GAS_URL);

async function gasCall(action, params) {
  if (!gasConfigured()) throw new Error('GAS連携が未設定です（GAS_API_URL / GAS_API_TOKEN）');
  if (!GAS_URL_OK) throw new Error('GAS_API_URL が不正です（script.google.com の /exec のみ許可）');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000); // 45秒でタイムアウト
  let res;
  try {
    res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: GAS_TOKEN, params: params || {} }),
      redirect: 'follow', // GAS は 302→googleusercontent へ。fetch は GET で追従し結果JSONを取得
      signal: ctrl.signal
    });
  } finally { clearTimeout(timer); }
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error('GAS応答が不正: ' + text.slice(0, 200)); }
  if (!j.ok) throw new Error(j.error || 'GASエラー');
  return j.result;
}

module.exports = { gasCall, gasConfigured };

'use strict';
/** 日付/ID ユーティリティ（Asia/Tokyo 基準） */

function jstStamp() {
  // 'YYYY-MM-DD HH:mm:ss'（Asia/Tokyo）
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date());
}
function todayStr() { return jstStamp().slice(0, 10); }
function nowStamp() { return jstStamp().replace(' ', 'T'); }

function newId(prefix) {
  const rnd = Math.random().toString(36).slice(2, 8);
  return (prefix || 'c') + Date.now().toString(36) + rnd;
}

module.exports = { todayStr, nowStamp, newId };

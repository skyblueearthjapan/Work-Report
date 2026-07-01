/**
 * 案件（Cases）の CRUD とスキーマ変換
 * 仕様書「7. サーバー関数 API」契約に対応。
 * フロントには prototype と同じオブジェクト形（kanin:{stamped,name}, ネスト配列）で返す。
 */

/* ---------- 行 ⇔ オブジェクト 変換 ---------- */

/** シート1行(配列) → フロント用ケースオブジェクト。 */
function rowToCase_(row) {
  var o = {};
  for (var i = 0; i < CASE_COLUMNS.length; i++) {
    o[CASE_COLUMNS[i]] = row[i];
  }
  var c = {
    id: String(o.id || ''),
    type: o.type || 'LW',
    status: o.status || '未着手',
    koban: str_(o.koban), motoKoban: str_(o.motoKoban), nohinNo: str_(o.nohinNo),
    kobanName: str_(o.kobanName), nohinSaki: str_(o.nohinSaki), okyakuSub: str_(o.okyakuSub),
    basho: str_(o.basho), tantou: str_(o.tantou), tel: str_(o.tel),
    kishu: str_(o.kishu), katashiki: str_(o.katashiki), seiban: str_(o.seiban), nenGappi: str_(o.nenGappi),
    yoteibi: str_(o.yoteibi), shijiNaiyou: str_(o.shijiNaiyou),
    paid: o.paid || '有償', genin: str_(o.genin), shori: str_(o.shori),
    oshaName: str_(o.oshaName), tantoushaName: str_(o.tantoushaName),
    signatureFileId: str_(o.signatureFileId),
    signature: '', // 表示用 dataURL/URL は getCase 時に補完（S4）
    kanin: { stamped: toBool_(o.kaninStamped), name: str_(o.kaninName) },
    workTypes: parseJson_(o.workTypesJson, {}),
    confirmItems: parseJson_(o.confirmItemsJson, []),
    staff: parseJson_(o.staffJson, []),
    commonWork: parseJson_(o.commonWorkJson, []),
    commonTravel: parseJson_(o.commonTravelJson, []),
    archived: toBool_(o.archived),
    closedAt: str_(o.closedAt),
    createdAt: str_(o.createdAt),
    updatedAt: str_(o.updatedAt),
    pdfFileId: str_(o.pdfFileId),
    driveFolderId: str_(o.driveFolderId)
  };
  return c;
}

/** フロント用ケースオブジェクト → シート1行(配列)。 */
function caseToRow_(c) {
  var kanin = c.kanin || {};
  var map = {
    id: c.id || '',
    type: c.type || 'LW',
    status: c.status || '未着手',
    koban: str_(c.koban), motoKoban: str_(c.motoKoban), nohinNo: str_(c.nohinNo),
    kobanName: str_(c.kobanName), nohinSaki: str_(c.nohinSaki), okyakuSub: str_(c.okyakuSub),
    basho: str_(c.basho), tantou: str_(c.tantou), tel: str_(c.tel),
    kishu: str_(c.kishu), katashiki: str_(c.katashiki), seiban: str_(c.seiban), nenGappi: str_(c.nenGappi),
    yoteibi: str_(c.yoteibi), shijiNaiyou: str_(c.shijiNaiyou),
    paid: c.paid || '有償', genin: str_(c.genin), shori: str_(c.shori),
    oshaName: str_(c.oshaName), tantoushaName: str_(c.tantoushaName),
    signatureFileId: str_(c.signatureFileId),
    kaninStamped: toBool_(kanin.stamped),
    kaninName: str_(kanin.name),
    workTypesJson: JSON.stringify(c.workTypes || {}),
    confirmItemsJson: JSON.stringify(c.confirmItems || []),
    staffJson: JSON.stringify(c.staff || []),
    commonWorkJson: JSON.stringify(c.commonWork || []),
    commonTravelJson: JSON.stringify(c.commonTravel || []),
    archived: toBool_(c.archived),
    closedAt: str_(c.closedAt),
    createdAt: str_(c.createdAt),
    updatedAt: str_(c.updatedAt),
    pdfFileId: str_(c.pdfFileId),
    driveFolderId: str_(c.driveFolderId)
  };
  return CASE_COLUMNS.map(function (col) { return map[col]; });
}

function str_(v) { return (v === null || v === undefined) ? '' : String(v); }

/* ---------- 低レベル行アクセス ---------- */

/** id から {sheet,rowIndex,case} を返す。無ければ null。 */
function findCaseRow_(id) {
  var sh = getCasesSheet_();
  var last = sh.getLastRow();
  if (last < 2) return null;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      var rowIndex = i + 2;
      var row = sh.getRange(rowIndex, 1, 1, CASE_COLUMNS.length).getValues()[0];
      return { sheet: sh, rowIndex: rowIndex, data: rowToCase_(row) };
    }
  }
  return null;
}

/** ケースオブジェクトを新規行として追加。 */
function insertCaseRow_(sh, c) {
  sh.appendRow(caseToRow_(c));
}

/* ---------- 公開 API（google.script.run から呼ぶ） ---------- */

/**
 * トップ表示に必要な状態を一括取得（未クローズ案件＋履歴件数）。
 * 1回のシート走査で両方を返し、往復を減らす。
 */
function getAppState() {
  var sh = getCasesSheet_();
  var last = sh.getLastRow();
  var cases = [], hist = 0;
  if (last >= 2) {
    var rows = sh.getRange(2, 1, last - 1, CASE_COLUMNS.length).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i][0]) continue;
      var c = rowToCase_(rows[i]);
      if (c.archived) hist++; else cases.push(c);
    }
  }
  return { cases: sortByUpdatedDesc_(cases), historyCount: hist };
}

/** 未クローズ案件の配列（トップ用）。新しい順。 */
function getCases() {
  var sh = getCasesSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, CASE_COLUMNS.length).getValues();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    var c = rowToCase_(rows[i]);
    if (!c.archived) out.push(c);
  }
  return sortByUpdatedDesc_(out);
}

/** クローズ済み案件を横断 AND 検索して返す（履歴用）。 */
function getHistory(query, type) {
  var sh = getCasesSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, CASE_COLUMNS.length).getValues();
  var terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(function (t) { return t; });
  var wantType = type || 'all';
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    var c = rowToCase_(rows[i]);
    if (!c.archived) continue;
    if (wantType !== 'all' && c.type !== wantType) continue;
    if (terms.length) {
      var hay = [
        c.koban, c.motoKoban, c.seiban, c.nohinSaki, c.okyakuSub, c.kishu,
        c.katashiki, c.kobanName, c.tantou, c.closedAt, c.yoteibi
      ].filter(Boolean).join(' ').toLowerCase();
      var ok = terms.every(function (t) { return hay.indexOf(t) !== -1; });
      if (!ok) continue;
    }
    out.push(c);
  }
  return sortByClosedDesc_(out);
}

/** 案件1件（ネスト展開済み・署名URL補完）。 */
function getCase(id) {
  var found = findCaseRow_(id);
  if (!found) return null;
  return withSignatureUrl_(found.data);
}

/**
 * 新規/更新（id の有無で判定）。
 * 更新時は既存行に受領フィールドを上書きマージし、signatureFileId 等の消失を防ぐ。
 * @return 保存後の id
 */
function saveCase(caseObj) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getCasesSheet_();
    var now = nowStamp_();
    if (caseObj && caseObj.id) {
      var found = findCaseRow_(caseObj.id);
      if (found) {
        var merged = mergeCase_(found.data, caseObj);
        merged.updatedAt = now;
        merged.createdAt = found.data.createdAt || now;
        sh.getRange(found.rowIndex, 1, 1, CASE_COLUMNS.length).setValues([caseToRow_(merged)]);
        return merged.id;
      }
    }
    // 新規
    var nc = caseObj || {};
    nc.id = newId_('c');
    nc.oshaName = nc.oshaName || nc.nohinSaki || '';
    nc.tantoushaName = nc.tantoushaName || (nc.staff && nc.staff[0] ? nc.staff[0].name : '');
    nc.createdAt = now;
    nc.updatedAt = now;
    insertCaseRow_(sh, nc);
    return nc.id;
  } finally {
    lock.releaseLock();
  }
}

/** 既存ケースに受領オブジェクトのキーだけを浅くマージ。 */
function mergeCase_(base, incoming) {
  var out = {};
  Object.keys(base).forEach(function (k) { out[k] = base[k]; });
  Object.keys(incoming).forEach(function (k) {
    if (incoming[k] !== undefined) out[k] = incoming[k];
  });
  // signature 表示用フィールドは行に保存しない
  delete out.signature;
  return out;
}

/** 複製：新 id・工番に「-複製」・未着手・サイン/確認印クリア。 */
function duplicateCase(id) {
  var found = findCaseRow_(id);
  if (!found) throw new Error('複製元が見つかりません: ' + id);
  var c = found.data;
  var nc = JSON.parse(JSON.stringify(c));
  nc.id = newId_('c');
  nc.koban = (c.koban || '') + '-複製';
  nc.status = '未着手';
  nc.archived = false;
  nc.closedAt = '';
  nc.signatureFileId = '';
  nc.signature = '';
  nc.kanin = { stamped: false, name: (c.kanin && c.kanin.name) || '' };
  nc.createdAt = nowStamp_();
  nc.updatedAt = nc.createdAt;
  insertCaseRow_(getCasesSheet_(), nc);
  return nc.id;
}

/** 物理削除（トップの⋯メニュー）。 */
function deleteCase(id) {
  var found = findCaseRow_(id);
  if (!found) return false;
  found.sheet.deleteRow(found.rowIndex);
  return true;
}

/** クローズ：確認印済みが前提。archived=true, closedAt 記録。 */
function closeCase(id) {
  var found = findCaseRow_(id);
  if (!found) throw new Error('案件が見つかりません: ' + id);
  if (!(found.data.kanin && found.data.kanin.stamped)) {
    throw new Error('確認印が押されていないためクローズできません。');
  }
  var c = found.data;
  c.archived = true;
  c.status = 'クローズ';
  c.closedAt = todayStr_();
  c.updatedAt = nowStamp_();
  found.sheet.getRange(found.rowIndex, 1, 1, CASE_COLUMNS.length).setValues([caseToRow_(c)]);
  return true;
}

/** 確認印を押す（kaninStamped=true, kaninName 記録）。API契約 stampKanin。 */
function stampKanin(id, name) {
  return updateCaseFields_(id, function (c) {
    c.kanin = { stamped: true, name: name || (c.kanin && c.kanin.name) || (c.type === 'LW' ? '製造部 田中' : 'TSC 木下') };
  });
}

/**
 * 案件1件を読み込み→mutator で書き換え→行を更新（排他）。
 * Drive/PDF/確認印など単一フィールド更新の共通経路。
 * @return 更新後のケースオブジェクト
 */
function updateCaseFields_(id, mutator) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findCaseRow_(id);
    if (!found) throw new Error('案件が見つかりません: ' + id);
    var c = found.data;
    mutator(c);
    c.updatedAt = nowStamp_();
    found.sheet.getRange(found.rowIndex, 1, 1, CASE_COLUMNS.length).setValues([caseToRow_(c)]);
    return c;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- 並び替え / 補助 ---------- */

function sortByUpdatedDesc_(arr) {
  return arr.sort(function (a, b) {
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}
function sortByClosedDesc_(arr) {
  return arr.sort(function (a, b) {
    return String(b.closedAt || '').localeCompare(String(a.closedAt || ''));
  });
}

/** 署名 fileId → 表示用 URL を付与（S4 で Drive 実装。無ければ空）。 */
function withSignatureUrl_(c) {
  if (c.signatureFileId) {
    try {
      c.signature = getSignatureDataUrl_(c.signatureFileId);
    } catch (err) {
      c.signature = '';
    }
  }
  return c;
}

/** 種別ごとの確認事項デフォルト（プロト defaultConfirm 相当）。 */
function defaultConfirm_(type) {
  if (type === 'LW') {
    return [
      { key: 'brake', label: 'ブレーキ調整スイッチOFF', value: '' },
      { key: 'rbpos', label: 'R/B+POSの作業原点復帰', value: '' },
      { key: 'force', label: '強制運転時からの復帰', value: '' }
    ];
  }
  return [
    { key: 'doukou', label: '動作確認', value: '' },
    { key: 'anzen', label: '安全確認', value: '' },
    { key: 'souji', label: '清掃・片付け', value: '' }
  ];
}

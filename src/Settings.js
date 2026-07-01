/**
 * 設定（Settings）— 送信先・件名・本文・ブランド名
 * 設定シートは key/value の縦持ち。
 */

/** 設定を {email,subject,body,companyLW,companyTS} で返す。 */
function getSettings() {
  var sh = getSettingsSheet_();
  var map = readSettingsMap_(sh);
  var def = defaultSettings_();
  var out = {};
  Object.keys(def).forEach(function (k) {
    out[k] = (k in map && map[k] !== '') ? String(map[k]) : def[k];
  });
  return out;
}

/** 設定を保存（部分更新可）。渡されたキーのみ上書き。 */
function saveSettings(obj) {
  if (!obj) return getSettings();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = getSettingsSheet_();
    var last = sh.getLastRow();
    var keyRows = {};
    if (last >= 2) {
      var keys = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < keys.length; i++) {
        if (keys[i][0] !== '') keyRows[String(keys[i][0])] = i + 2;
      }
    }
    Object.keys(obj).forEach(function (k) {
      var v = obj[k] === null || obj[k] === undefined ? '' : String(obj[k]);
      if (keyRows[k]) {
        sh.getRange(keyRows[k], 2).setValue(v);
      } else {
        sh.appendRow([k, v]);
      }
    });
    return getSettings();
  } finally {
    lock.releaseLock();
  }
}

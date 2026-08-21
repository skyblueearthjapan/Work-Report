# 引き継ぎ書 — デジタル作業報告書アプリ

次にこのプロジェクトを担当するエージェント／開発者向けの引き継ぎ記録。
最終更新: 2026-08-22。GitHub: `skyblueearthjapan/Work-Report`（main）。
直近コミット基準: `1e96f39`（スマホでの横あふれを修正）。フェーズEまで**VPS本番反映済み**、ローカル／GitHub／VPS の3拠点同期済み。

> **重要**: 秘密情報（APIキー・トークン・OAuthシークレット等）は**このリポジトリには含めていません**。
> 実値は VPS の `/opt/lineworks/.env`（600権限）と GAS の Script Properties にあります。
> 取得例: `ssh lineworks-vps-user "cat /opt/lineworks/.env"`。

---

## 0. 現状（本番）

- **本番はVPS版**（Node/Express + SQLite + 静的SPA）。公開URL: **https://lineworks.tailaa1b31.ts.net**（Google組織ログイン必須）。
- 旧 **GAS版アプリUIは引退**。GASは「Google操作の裏方API（doPost/トークン）」としてのみ稼働。
- 設計の正（プロト/引継仕様）: `design/untitled/project/`（`作業報告書アプリ.dc.html`, `GAS実装_引き継ぎ仕様書.dc.html`）。

---

## 1. これまでにやったこと（時系列）

### フェーズA: GAS版アプリの実装（`src/`）
「デジタル作業報告書アプリ」をスプレッドシートバインド型GAS Web Appとして S1〜S7 で実装:
- 全9画面（トップ/種別選択/新規・編集/報告書入力/サイン/PDFプレビュー/送信/設定/履歴）。
- SpreadsheetをDBに（案件/設定シート、ネストはJSON列）、Drive保管（案件別フォルダにPDF＋サイン）、GmailApp送信、Gemini（処置整形/銘板OCR）。
- 業務ルール（確認印ゲート、連名/別行動、時間集計、履歴横断検索）。
- 追加要望対応: **クローズ時に自動メール送信（TO/CC複数）**、**外部マスター取込**（工番→納品先/住所/装置名 自動補完、部署で名簿絞り込み、出張部署設定）。

### フェーズB: VPS版へ移行（現行本番）
きっかけ: **GASのHtmlServiceはサンドボックスiframeのためマイク(getUserMedia)が使えない** → 現場の音声入力が動かない。Codexにも相談し「フロントをGAS外のHTTPSに出すべき」と一致 → VPS化を決定。
- **V1**: Node/Express雛形 + Docker + **2個目Tailscaleノード(`lineworks`)＋Funnel**で公開（手順書 `DEPLOY-VPS-2nd-Tailscale.md`）。既存`marin`(:5173)は不可侵。
- **V2**: 全9画面SPAを `web/` へ移植（GAS版UIを流用、`google.script.run`→`fetch`）。SQLite(better-sqlite3)でCRUD/履歴/設定。
- **V3**: **Google操作はGASへ委譲（Option A・サービスアカウント不使用）**。GASに doPostトークンAPI(`src/Api.js`)を追加、VPSの`server/gas.js`がサーバー間で呼ぶ。Drive保管・Gmail送信・マスター取込を会社アカウントで実行。
- **V4**: **アプリ内マイク録音**(MediaRecorder)→**WAV(16kHz mono)変換**→Geminiで文字起こし＆整形。銘板OCR・処置整形もVPSのGeminiへ。→ **当初のマイク課題を解決**。
- **V5**: **Googleログイン**（`lineworks-local.info`ドメイン限定、HMAC署名クッキー、state/CSRF・aud・email_verified検証）。

### フェーズC: クロスレビューと改善
- **Codexクロスレビュー**でセキュリティ強化（下記「反映済み」参照）。
- 音声: `;codecs`付きMIMEのbase64解析バグ修正＋WAV変換で安定化。
- AI整形の読みやすさ: 内容適応（●箇条書き/①②③番号/【見出し】）、few-shot、思考漏れ防止(thinkingBudget:0)、**お客様向けの丁寧さ＋専門性のハイブリッド**トーン、スタイル選択ボタン。
- 長文対策: モーダルのスクロール改善、**ボリューム上限**（改行を約20字分として加算＝空行の水増しを抑止／原因300・処理600）、音声反映を追記→置換（重複防止）、プレビュー本文の自動フォント縮小、マスター即時更新ボタン＋最終取込時刻表示、名簿の出張部署絞り込みを実効化。

### フェーズD: 銘板読み取りの項目拡張（2026-07-22, commit `92d5de6`）
- きっかけ: 現場の設備は**打刻（刻印）銘板**（低コントラスト・反射・ブレあり）。実写真2枚（`Sampledata/銘版写真01.JPEG`, `銘版写真01‐1.JPEG` = LINE WORKS製 Positioner SK8000S）で検証。この解像度なら現行Geminiで読み取り可能と確認。
- **読み取り項目に「最大積載重量」「本体重量」を追加**（従来は機種/型式/製番/製造年月の4項目）。フィールド名 `saidaiSekisai` / `hontaiJuryo`。
  - `server/ai.js` `readPlate`: プロンプト（打刻前提＋対応語 積載/LOAD・自重/WEIGHT を追記）、`response_schema`、返却値に2項目追加。重量は「数値＋単位」文字列（例`5000kg`）。
  - `web/app.js`: `blankForm`のデータ項目／機械・銘板情報カードの入力欄／Report画面の銘板グリッド／銘板モーダルの読取結果表示・説明文／`applyPlate`の反映／PDFプレビューの銘板情報欄／`mockPlate`（Gemini未設定時の暫定値）に2項目を反映。
- **信頼性対策は「現状のまま（手修正で担保）」を選択**（ユーザ判断）。AIが読めない項目は空欄→手入力。プロンプト強化・画像前処理は未実施（下記TODO参照）。
- **APK/PWA化を相談**（実装なし・方針のみ）: 「常駐（バックグラウンド）アプリ」はこの対話的アプリでは無価値と整理。まず**PWA化（manifest+service worker）**が費用対効果最良、と結論。詳細は下記TODO・気になる点。

### フェーズE: 帳票・モバイル表示の実運用調整（2026-08-17）
- **作業内容の静的ラベル `（原因）（処理）` を削除**（`ee660de`）。AI整形が出力する `【原因】【作業内容】【結果】` の見出しと重なり、PDF上で見出しが二重表示になっていたため。データ構造(`genin`/`shori`)は変更なし、既存案件のDB書き換えも不要（本番DBを調査し、実案件 LW25126 の本文はAIの正規見出しであることを確認。一括置換すると文書構造が壊れるため実施していない）。
- **確認印ゲートを「クローズのみ」に緩和**。印刷・PDF保存は押印前でも可能に（現場でお客様控えを出すため）。確認印欄は空欄で出力されるので未確認であることは印刷物から分かる。
- **印刷を A4 1枚に自動収納**。`doPrint`でシートを`#fitwrap`で包み、印刷可能高さ(1039px = 297mm − 上下余白22mm)を超えた分だけ縮小。**縮小のみで拡大はしない**ため通常案件の見た目は不変。
- **PDFの時間欄を整理**。各行に出ていた日別の `計 ○時間○分` バッジ（作業時間・移動時間の両方に同じ日別合計が重複表示されていた）を廃止し、移動時間の下に **`総時間：○時間○分`（作業＋移動）の1行を右寄せで新設**。`作業時間 合計`/`移動時間 合計` の小計行は従来どおり残す。バッジ専用だった`dayMap`/`addDay`/`dayTot`/`dayTotal`は死にコードになるため併せて削除。
- **スマホでの横あふれを修正**（`1e96f39`）。工番編集画面で「御担当者名」が右端にはみ出し、「様」がずれ、画面が横スクロールする症状。原因は3つの合わせ技: ①`inpSm` にだけ `width` 指定が無く、入力欄がブラウザ既定の固有幅(約180px)になっていた（`inpStyle` には `width:100%` があるため**新規登録画面では起きず、編集画面だけで再現**した）、②flex要素は既定で `min-width:auto` のため固有幅より縮まず、御社名＋御担当者名の2列で約372pxを要求してスマホ幅を超えた、③`.scr` は `overflow-y:auto` を指定した時点で **`overflow-x` が `visible` から `auto` に格上げ**され、あふれが横スクロールとして現れていた。修正は計5行（`inpSm`に`width:100%` / `styles.css`に`input,textarea,select{min-width:0;max-width:100%}` / `.scr`に`overflow-x:hidden`）。
- **外部エージェント向けの実装手順書を3本作成**（本リポジトリ外）。工番・納入先・製品名の取得方法をまとめたもの。→ **§6 参照**。本アプリのキー名やAPIを変えると壊れる先があるので必ず目を通すこと。

**このフェーズのコミット**: `ee660de`（ラベル削除）→ `cb8fb51`（押印前印刷・A4 1枚化）→ `d5e576c`（時間欄整理）→ `1e96f39`（スマホ横あふれ）。4本ともpush済み・VPS反映済み。

**このフェーズで意図的に「やらなかった」こと**（再検討時の判断材料）:
- **本番DBの一括置換**。当初「既存案件の`【原因】`も消す」方針だったが、本番DBを調査した結果、実案件 `cmsphiv49v5apbf`(LW25126) の `shori` はAI整形が生成した`【原因】【作業内容】【結果】`という**正規の文書構造**だった。一括置換すると本文が壊れるため中止。合計値と同じく**表示は都度算出なので、ラベル削除だけで既存案件にも反映される**。
- **サンプル案件c6の`【原因】/【処理】`除去**。静的ラベルが消えた今は見出しとして機能するだけで二重にならないため据え置き。
- **A4縮小率の下限設定**。極端な長文で文字が小さくなる件は、下限を設けず「必ず1枚」を優先（ユーザ判断）。TODO-5に保留として記録。

---

## 2. アーキテクチャ / 構成

```
[現場タブレット/PC] ── Googleログイン ──▶ https://lineworks.tailaa1b31.ts.net (VPS)
  VPS(Node/Express) : UI(web/) ＋ REST(server/) ＋ SQLite(data/worklog.db) ＋ マイク録音 ＋ Gemini
        │ サーバー間(トークン, 画面なし)
        ▼
  会社GAS(src/, doPost API) : Drive保管 / Gmail送信 / 外部マスター取込（会社アカウントで実行）
```

### VPS
- Hostinger, `31.97.109.137`, `srv1508169`, Ubuntu 24.04。運用ユーザ `lineworks`(uid1001)。Docker(`sg docker -c '...'` でラップ)。
- SSHエイリアス: `lineworks-vps`(root) / `lineworks-vps-user`(lineworks)。鍵は `~/.ssh/.ssh_LINEWORKS/`。
- 配置: `/opt/lineworks`（このリポジトリをclone）。
- 公開: Tailscaleノード`lineworks`(IP 100.107.28.110) ＋ Funnel。サイドカーは**別composeプロジェクト`lineworks-ts`**（`docker-compose.tailscale.yml`, `name: lineworks-ts`）。鍵失効は無効化済み。
- コンテナ: `lineworks-web`(app), `tailscale-lineworks`(公開)。**既存`marin-pdf-web`(:5173)には触れない**。

### リポジトリ構成
- `server/` … `index.js`(ルート/静的), `auth.js`(Googleログイン), `gas.js`(GAS委譲), `ai.js`(Gemini), `store.js`(SQLite CRUD), `db.js`, `util.js`, `sampleData.js`
- `web/` … `index.html`(/api/boot取得→app.js起動), `app.js`(SPA本体), `styles.css`, `logo.js`
- `src/` … GAS（`Api.js`=doPost API, `Code.js`=doGet案内/共通, `Cases.js`, `Drive.js`, `Mail.js`, `Ai.js`, `Master.js`, `Setup.js`, `Settings.js`, `SampleData.js`, `index/js/css/logo.html`=旧UI・**不使用**）
- ルート: `Dockerfile`, `docker-compose.yml`(app:5174), `docker-compose.tailscale.yml`, `ts-serve.json`, `.env.example`, `DEPLOY-VPS-2nd-Tailscale.md`, `README.md`（※GAS前提のまま・要更新）, `design/`, `Sampledata/`。

### データ
- **SQLite** `data/worklog.db`（Dockerのbindで永続）: `cases`(案件をJSONまるごと保持＋id/type/archived/koban/updatedAt/closedAt列), `settings`(key/value), `meta`(masterミラー等)。案件検索は全件走査（数百件規模で問題なし）。
- **Drive**（GAS委譲）: 親`作業報告書アプリ_保管フォルダ`→案件`工番_お客様名_作業日`→中にPDF＋サインPNG。
- **外部マスター**: スプレッドシート `1iu5HoaknlW1W1HheeYv0jqcRq-aY0SyEE2seQd2pHkQ`（工番/作業員/部署）。日次6:07(JST)cron＋設定画面の手動ボタンで取込→SQLiteミラー。

### GAS
- scriptId `1t7Oefa1OFg929nOJraIN460MuzU4Yx_ASvRWvDTb_yDwATj9t3OuAm4M`（clasp, rootDir=src）。
- Web App デプロイ `AKfycbyYcfCrvQdWIx_z8KtFUgmvygk_n9TJP91ZZmltf7e8wM1cRBJCw4N1xKeWuSfVtlad`（/exec, **ANONYMOUS**＋トークン）。同一IDを更新するのでURL不変。
- メニュー「作業報告書アプリ」: 初期化＋サンプル/マスター今すぐ取込/自動取込設定/**VPS連携APIトークン発行**/Geminiキー設定。

### 環境変数（VPS `/opt/lineworks/.env`・600・gitignore）
`PORT, GAS_API_URL, GAS_API_TOKEN, GEMINI_API_KEY, GEMINI_MODEL(=gemini-2.5-flash), GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, ALLOWED_DOMAIN(=lineworks-local.info), SESSION_SECRET, PUBLIC_ORIGIN`。Tailscale鍵は `/opt/lineworks/.env.tailscale`。

### デプロイ手順（今後）
```bash
# ローカル: 実装 → commit → push (main)
# VPS: 反映
ssh lineworks-vps-user "cd /opt/lineworks && git pull && sg docker -c 'docker compose up -d --build'"
#   フロントだけの変更なら up -d --build の代わりに restart web でも可（ソースはbind）
# GAS を変えたとき（clasp）
clasp push -f && clasp deploy -i AKfycbyYcfCrvQdWIx_z8KtFUgmvygk_n9TJP91ZZmltf7e8wM1cRBJCw4N1xKeWuSfVtlad --description "..."
# 検証（公開は認証で保護。curlで見えるのは /api/health と / の302のみ）
ssh lineworks-vps "curl -s -o /dev/null -w '%{http_code}\n' https://lineworks.tailaa1b31.ts.net/api/health"
```

---

## 3. 残作業（TODO）

1. **README.md がGAS前提のまま** → VPS構成へ全面更新。
2. **支給値の確定反映**: 自社正式名称・住所（現状プロト値）、送信先メール確定、CC既定。
3. **旧GAS版UI(`src/`のjs/css/index/logo.html)の整理**（不使用・残置）。関数の重複（`src/Ai.js`のGemini等）も現行はVPS側が主。
4. **Codexレビューの後回し項目**（内部ツールとして現状許容）:
   - レート制限（express-rate-limit等）／IP制限
   - id_tokenの完全署名検証（`google-auth-library` `verifyIdToken`）
   - エラーメッセージのサニタイズ（詳細はログ、応答は汎用）
   - メール宛先のドメイン/許可リスト制限
5. **PDFレイアウトの長文強化**: 印刷側は「A4 1枚に自動縮小」で対応済み（2026-08-17）。残るのは html2canvas バックアップ（複数ページに分割される）との見た目整合。極端な長文では縮小率が下がり文字が小さくなるため、下限を設けて続葉に流す案も保留中。
6. **実機E2E**（特にiOS Safari）: 録音→WAV→Gemini、サイン、確認印、クローズ→Drive/自動メール、履歴 の一気通貫確認。
7. **OAuth同意画面**をInternal（組織内）に、または検証状態を確認（Externalだと未確認警告/テストユーザ制限の可能性）。
8. **マスター即時同期**（任意）: 元シート更新時に `/api/master/refresh` を叩くWebhook連携（現状は日次＋手動）。
9. **作業員コードのひも付け保存**（将来の勤怠連携等）。現状スタッフは氏名文字列のみ保持。
10. **バックアップ運用**: `data/worklog.db`（SQLite）と VPS `.env` の定期バックアップ。
11. **PWA化（推奨・次の着手候補）**: 現状は素のSPAで manifest / service worker **未対応**（`web/index.html`にviewportのみ）。manifest＋アイコン＋SWを追加すれば「ホーム画面アイコン起動・全画面・見た目ネイティブ」が半日程度で入る。**「常駐（バックグラウンド）アプリ化」は不要**（対話的アプリのため無価値）。APK化（TWA）はPWAの後、Playストア/MDMで一括配布したい場合のみ検討。**未確認の前提**: ①現場は電波が届くか（届かない→オフライン設計が本命・大作業／届く→PWAで十分）、②配布方法の希望（各自でホーム追加 or 会社が一括インストール）。この2点をユーザに確認してから着手すること。
12. **銘板読み取りの信頼性強化（保留中）**: 打刻銘板が反射・ブレ・低コントラストで読めない場合の対策。案=(a)プロンプトに「打刻・エンボスで低コントラスト」前提を更に強調＋各項目に信頼度/読めない旨を返させる、(b)送信前の画像前処理（コントラスト強調・グレースケール・二値化）、(c)「AI推定値です。確認してください」の明示UI。現状はユーザ判断で**手修正のみで担保**＝未実装。要望が出たら着手。
13. **GAS連携の断続的な失敗への対策（新規・要判断）**: GASが稀にGoogleの警告HTMLを返し、`server/gas.js` が「GAS応答が不正」で例外を投げる。本番ログで **2026-08-12 12:04 JST にサインのDrive保存が2回失敗**（`server/index.js:98` の `saveSignature`）、**08-13 06:07 にマスター日次取込が1回失敗**を確認（8/14以降は正常、8/17朝の取込も成功）。恒常障害ではないが、**サイン保存の失敗はお客様のサインがDriveに残らない**ため実害がある。対策案=(a)`gasCall`にリトライ＋指数バックオフ、(b)失敗をUIで明示、(c)失敗時の通知。**まず 2026-08-12 に取得したサインがDriveに存在するか確認が必要**（未確認のまま）。ログ確認: `ssh lineworks-vps-user "sg docker -c 'docker logs -t lineworks-web' | grep 'GAS応答が不正'"`。
14. **GASに読み取り専用API `getMaster` を追加（推奨・未実装）**: 現状 `refreshMaster` は `importMasters_()` を伴うため、呼ぶたびに元シート再読込＋ミラーシート全書き換えが走る（数秒〜十数秒・**共有シートへの書き込み発生**）。マスターを読むだけの外部利用者（§6の3エージェント）には重すぎる。`src/Api.js` の switch に `case 'getMaster': out = getMasterData(); break;` の1行を足し、`clasp push -f && clasp deploy -i <同一ID>` するだけ。§6の手順書3本にも「未実装」と明記済みなので、入れたら手順書側も更新すること。
15. **印刷のポップアップブロック対策（モバイル・未確認）**: `doPrint` は `window.open` した別ウィンドウで印刷する。iOS Safari等でブロックされると `window.print()` にフォールバックし、**帳票ではなくアプリ画面そのものが印刷され、A4 1枚への自動縮小も効かない**。一時iframeで印刷する方式に切り替えれば解決する。実機未確認。

## 4. 気になる点・注意（ハマりどころ）

- **秘密情報はリポジトリに無い**。VPS `.env`／GAS Script Properties が実体。漏洩時は各所で再発行（GASメニューでトークン再発行、Gemini/OAuthはコンソール、Tailscaleは管理画面）。
- **clasp が `invalid_rapt` で切れる** → `clasp login` 再実行（会社アカウント）。GASデプロイ前に発生しがち。
- **Tailscaleサイドカーは別プロジェクト`lineworks-ts`**。アプリ更新で `--remove-orphans` を付けない（公開ノードを巻き込む）。状態は `./ts-lineworks-state` に永続（再作成しても同一ノード）。
- **Gemini 2.5 は thinking を無効化必須**（`generationConfig.thinkingConfig.thinkingBudget = 0`）。有効だと推論文が処置欄に混入する（`server/ai.js`で対応済）。
- **Gemini音声はWAV推奨**。webmは不可のことがある。フロントで録音をWAV(16kHz mono)に変換して送る（`web/app.js` `audioBlobToWav`）。`server/ai.js`の`dataUrlParts`は`;codecs`付きMIMEに対応済。
- **文字数制限は「ボリューム」判定**（改行×20を加算）。上限は `web/app.js` の `LIMIT`（原因300/処理600）と `NL_WEIGHT`。調整はここ。
- **認証は環境変数が揃うと有効化**。1つでも欠けると`authEnabled=false`で**保護オフ**になる設計（fail-open）。本番では常に全部設定しておくこと（ドメイン判定はfail-safe済：ALLOWED_DOMAIN空なら誰も入れない）。セッション12h。
- **案件データはSQLiteのJSON**。スキーマ変更に強い反面、検索は全件走査。件数が大きく増えたらPostgres移行を検討（`store.js`差し替え）。
- **既存`marin`(:5173)には絶対に触れない**（同一VPS上の別サービス）。
- **GAS doPost はヘッダを読めない**ためトークンはJSON body。GAS側は定数時間比較(`safeEq_`)。VPS→GASは `script.google.com/.../exec` のみ許可＋45秒timeout。
- **PDF生成は2系統**: 「印刷・PDF保存」=`window.print`（ベクター）、クローズ時のDriveバックアップ=html2canvas+jsPDF（画像）。プレビュー`#pdf-print`を両者が使うので、レイアウト変更は両方に効く。ただし **A4 1枚への自動縮小は印刷側だけ**（`doPrint`の`#fitwrap`）。バックアップ側は従来どおり複数ページに分割されるので、両者の見た目は長文時に食い違う。
- **確認印ゲートは「クローズのみ」**（2026-08-17に変更）。印刷・PDF保存は押印前でも可能。ゲートはUI側のみで、サーバー検証は`server/store.js`の`closeCase`だけ。「印刷も止めたい」と言われたら、UIの`stampedBtns`を戻すだけでなくサーバー側に検証が無い点に注意。
- **メール実送信のテスト注意**: 既定TOは `genba-report@line-works.co.jp`。テスト時は設定で自分の宛先に変更してから。
- **銘板フィールドは6項目**（`kishu/katashiki/seiban/nenGappi/saidaiSekisai/hontaiJuryo`）。案件データは`web/app.js`の`blankForm`が起点。**追加項目を増やす時は必ず一連の6か所を揃える**: ①`blankForm`のデフォルト、②入力フォーム（機械・銘板情報カード）、③Report画面の銘板グリッド、④銘板モーダルの読取結果表示、⑤`applyPlate`の反映、⑥PDFプレビュー`銘板情報`欄。加えてサーバ`server/ai.js` `readPlate`の**プロンプト・response_schema・返却値**の3点。どこか漏れると「AIは読むが画面/PDFに出ない」等の片手落ちになる。
- **銘板Gmail共有APIの汎用化は未着手**: 別アプリからGmail送信を共有できるか相談あり（`src/Api.js`の`sendMail`は既に汎用HTTP API）。共有するなら添付base64直渡し・差出人名可変・クライアント別トークン・送信ログ・宛先allowlistが要る、と整理済み（実装なし）。要望が具体化したら着手。

- **モバイルで横あふれ→横スクロールが出たら、まず入力欄の幅指定と `min-width` を疑う**（2026-08-17に実際に発生）。`<input>` は幅未指定だとブラウザ既定の固有幅(約180px)を持ち、flex要素は既定 `min-width:auto` のため**それ以下に縮まない**。さらに `.scr`(`web/app.js`)は `overflow-y:auto` を指定した時点で **`overflow-x` が `auto` に格上げ**されるので、あふれがそのまま横スクロールになる。現在は `styles.css` の `input,textarea,select{min-width:0;max-width:100%}` と `.scr` の `overflow-x:hidden` で塞いである。**新しい入力欄を足すときは幅指定を忘れないこと**（`inpStyle`には`width:100%`があるのに`inpSm`には無く、それが原因だった）。なお時間行の日付欄など**インラインで `min-width` を持つ要素はインライン側が優先**されるので意図した下限は維持される。
- **`styles.css` はキャッシュされる**。`web/index.html` は `<link href="/styles.css">` とバージョン無しで参照しているため、CSSを変更したら**利用者にスーパーリロード(Ctrl+Shift+R)を案内する**必要がある（特に現場のタブレット/スマホ）。将来はクエリ文字列でのキャッシュバスティングを検討。
- **モバイル版という別コードは存在しない**。`web/` は `app.js`/`index.html`/`logo.js`/`styles.css` の4ファイルのみで、UA判定も `@media` も**ゼロ**（流動レイアウトのみ）。全デバイスに同一ファイルを配信するので、修正は自動的にスマホにも反映される。旧GAS版UI(`src/js.html`)は `doGet` が案内HTMLを返すだけなので踏まれない。
- **印刷の見た目は端末非依存**。画面プレビューは `max-width:600px` で縮むが、`doPrint` は別ウィンドウに `#sheet{width:600px}` の固定幅で流し込むため、スマホから印刷してもPCと同一のA4出力になる（ただしTODO-15のポップアップブロック時を除く）。

---

## 5. 参考ドキュメント
- `DEPLOY-VPS-2nd-Tailscale.md` … VPS公開(2個目Tailscaleノード)の詳細手順・落とし穴。
- `design/untitled/project/` … UI/業務仕様の正。
- コミット履歴（main）に S1〜S7 / V1〜V5 / 各改善が段階的に記録。

---

## 6. 外部エージェント向けに配布した資料（本リポジトリ外・2026-08-17）

社内の別プロジェクトから「工番・納入先・製品名を取りたい」という要望があり、本アプリの仕組みを解説した**実装手順書を3本**作成して各フォルダに置いた。**いずれも本リポジトリの外にある**ため、本アプリ側の仕様を変えると気付かないうちに壊れる。

配布先はいずれも `C:\Users\imaizumi.LINEWORKS-NET\Documents\` 配下。

| フォルダ | ファイル | 対象スタック |
|---|---|---|
| `test(4ton応用機)` | `工番マスター連携_実装手順書.md` | Node.js（`server.js`/PLC-Ladder-Assist） |
| `部品図作成agent` | `工番マスター連携_実装手順書.md` | Python（`engine/` `app/`） |
| `3D CAD Operator Agent` | `工番マスター連携_実装手順書.md` | Python（`engine/`） |

### 手順書に書いた内容（3本共通）
- **3項目のキー対応**（最重要）: 工番=`koban` / 納入先=`nohinSaki` / **製品名=`kishu`**。元シートの列名は「品名」だが、本アプリが品名を「装置名／機種」として扱っているためキーが `hinmei` ではない。**ここが一番の落とし穴**として各手順書で警告してある。
- **取得は会社GASの doPost API 一択**。VPSの `/api/*` は Googleログインのセッションcookie必須でサーバー間呼び出し不可、と明記。
- `refreshMaster` の副作用（再取り込みが走る＝重い・共有シートへの書き込み発生）と**キャッシュ必須**の警告 → TODO-14 と対。
- 実データの癖: `住友建機㈱` の全角合成文字、品名中の全角スペース（`油圧ディスクブレーキ　HB6000`）、`basho`が空の行、同一工番の重複可能性（アプリ本体は**先頭勝ち**＝`web/app.js` の `masterKoban()`）。
- 動くサンプルコード（リトライ・キャッシュ・タイムアウト込み、**追加依存ゼロ**）と動作確認チェックリスト。

### 参考: 配布時点のマスター実データ（2026-08-17 06:07 取込）
```
工番 930件 / 作業員 50件 / 部署 7件
例) koban=LW23125, uketsuke=住友建機㈱, nohinSaki=住友建機㈱,
    basho=千葉県千葉市稲毛区長沼原町731-1,
    kishu=4ton応用機アタッチメントポジショナー
```

### 注意
- **トークンの実値は手順書に書いていない**（取得手順のみ記載）。混入が無いことを検証済み。
- 3フォルダとも**コミットはしていない**（`部品図作成agent` と `3D CAD Operator Agent` はGit管理下）。
- 各エージェントの内部実装までは読んでいないため、手順書の「想定用途」節は**推定と明記**してある。

### 影響範囲（変更時に必ず確認）
`src/Master.js` の `getMasterData()` が返す**キー名**および `MASTER_SRC` の**列定義**を変えると、この3エージェントが壊れる。`src/Api.js` のアクション名やトークン方式を変えた場合も同様。変更時は上記3本の手順書も更新すること。

---

以上。修正・追加時はまず本書と `README`（更新後）を確認し、VPS `.env` の値は VPS 上で確認すること。

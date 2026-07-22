# 引き継ぎ書 — デジタル作業報告書アプリ

次にこのプロジェクトを担当するエージェント／開発者向けの引き継ぎ記録。
最終更新: 2026-07-22。GitHub: `skyblueearthjapan/Work-Report`（main）。
直近コミット基準: `92d5de6`（銘板読み取りに最大積載重量・本体重量を追加）。VPS本番反映済み。

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
5. **PDFレイアウトの長文強化**: 一定量超過で自動改ページ/続葉、印刷(window.print)とhtml2canvasバックアップの2系統の見た目整合。
6. **実機E2E**（特にiOS Safari）: 録音→WAV→Gemini、サイン、確認印、クローズ→Drive/自動メール、履歴 の一気通貫確認。
7. **OAuth同意画面**をInternal（組織内）に、または検証状態を確認（Externalだと未確認警告/テストユーザ制限の可能性）。
8. **マスター即時同期**（任意）: 元シート更新時に `/api/master/refresh` を叩くWebhook連携（現状は日次＋手動）。
9. **作業員コードのひも付け保存**（将来の勤怠連携等）。現状スタッフは氏名文字列のみ保持。
10. **バックアップ運用**: `data/worklog.db`（SQLite）と VPS `.env` の定期バックアップ。
11. **PWA化（推奨・次の着手候補）**: 現状は素のSPAで manifest / service worker **未対応**（`web/index.html`にviewportのみ）。manifest＋アイコン＋SWを追加すれば「ホーム画面アイコン起動・全画面・見た目ネイティブ」が半日程度で入る。**「常駐（バックグラウンド）アプリ化」は不要**（対話的アプリのため無価値）。APK化（TWA）はPWAの後、Playストア/MDMで一括配布したい場合のみ検討。**未確認の前提**: ①現場は電波が届くか（届かない→オフライン設計が本命・大作業／届く→PWAで十分）、②配布方法の希望（各自でホーム追加 or 会社が一括インストール）。この2点をユーザに確認してから着手すること。
12. **銘板読み取りの信頼性強化（保留中）**: 打刻銘板が反射・ブレ・低コントラストで読めない場合の対策。案=(a)プロンプトに「打刻・エンボスで低コントラスト」前提を更に強調＋各項目に信頼度/読めない旨を返させる、(b)送信前の画像前処理（コントラスト強調・グレースケール・二値化）、(c)「AI推定値です。確認してください」の明示UI。現状はユーザ判断で**手修正のみで担保**＝未実装。要望が出たら着手。

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
- **PDF生成は2系統**: 「印刷・PDF保存」=`window.print`（ベクター）、クローズ時のDriveバックアップ=html2canvas+jsPDF（画像）。プレビュー`#pdf-print`を両者が使うので、レイアウト変更は両方に効く。
- **メール実送信のテスト注意**: 既定TOは `genba-report@line-works.co.jp`。テスト時は設定で自分の宛先に変更してから。
- **銘板フィールドは6項目**（`kishu/katashiki/seiban/nenGappi/saidaiSekisai/hontaiJuryo`）。案件データは`web/app.js`の`blankForm`が起点。**追加項目を増やす時は必ず一連の6か所を揃える**: ①`blankForm`のデフォルト、②入力フォーム（機械・銘板情報カード）、③Report画面の銘板グリッド、④銘板モーダルの読取結果表示、⑤`applyPlate`の反映、⑥PDFプレビュー`銘板情報`欄。加えてサーバ`server/ai.js` `readPlate`の**プロンプト・response_schema・返却値**の3点。どこか漏れると「AIは読むが画面/PDFに出ない」等の片手落ちになる。
- **銘板Gmail共有APIの汎用化は未着手**: 別アプリからGmail送信を共有できるか相談あり（`src/Api.js`の`sendMail`は既に汎用HTTP API）。共有するなら添付base64直渡し・差出人名可変・クライアント別トークン・送信ログ・宛先allowlistが要る、と整理済み（実装なし）。要望が具体化したら着手。

---

## 5. 参考ドキュメント
- `DEPLOY-VPS-2nd-Tailscale.md` … VPS公開(2個目Tailscaleノード)の詳細手順・落とし穴。
- `design/untitled/project/` … UI/業務仕様の正。
- コミット履歴（main）に S1〜S7 / V1〜V5 / 各改善が段階的に記録。

以上。修正・追加時はまず本書と `README`（更新後）を確認し、VPS `.env` の値は VPS 上で確認すること。

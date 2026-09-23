# 帳票型入力の E2E テスト

新規登録（管理者）と作業報告書（作業者）の帳票型入力を、ヘッドレス Chrome で一通り操作して確かめる（64項目）。
入力画面（`web/app.js` の `viewFormSheet` / `renderFsSheet` まわり、`web/styles.css` の `.fs-*`）を変えたら実行する。

Drive 保存・メール送信・Gemini はローカルでは動かない（GAS・APIキー未設定のため、アプリは簡易動作に切り替わる）。

## 手順（Windows / PowerShell）

リポジトリの `data/` を汚さないよう、アプリを一時フォルダにコピーして動かす。

```powershell
$t = "$env:TEMP\wr-e2e"; New-Item -ItemType Directory -Force $t | Out-Null
Copy-Item -Recurse -Force server, web, package.json $t
Copy-Item test\e2e\seed-master.js $t
Set-Location $t
# Node 24 では better-sqlite3@11 のビルド済みが無いので 12 を入れる（テスト用コピーだけ。本番の package.json は変えない）
npm install better-sqlite3@12 express@4 node-cron@3 puppeteer-core@23 --no-save
node seed-master.js                      # DB 初期化（毎回、data\ を消してから）
$env:PORT = "5199"; $env:GEMINI_API_KEY = ""
Start-Process node -ArgumentList "server/index.js" -NoNewWindow
# puppeteer の launch はこの環境では失敗するため、Chrome を自分で起動して connect する
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList '--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9333',"--user-data-dir=$env:TEMP\wr-e2e-chrome",'about:blank'
Copy-Item <リポジトリ>\test\e2e\e2e-form.js $t
node e2e-form.js                         # PASS / FAIL が並ぶ。スクリーンショットは shots\
```

もう一度流すときは、サーバーを止めて `data\` を消し、`node seed-master.js` からやり直す（前回の入力が残っていると結果がずれる）。

## 書き方の注意
- 帳票の枠は、上に貼り付くツールバーや下のボタン帯に隠れることがある。テストの `click()` は枠を画面中央に寄せてから押している。
- 入力パネルは下から出るアニメーションがあるので、開いた直後は少し待ってから押す（`click()` の後に 300ms 待っている）。

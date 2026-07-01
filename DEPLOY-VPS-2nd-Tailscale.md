# VPS デプロイ手順書 — SSH 接続 & 2 個目 Tailscale ノードでの公開

このフォルダ（`Work Report`）で実装中のアプリを、**株式会社ラインワークスの運用 VPS**（Hostinger）に
デプロイし、**既存の `marin` とは別の 2 個目の Tailscale ノード**として独自 URL で公開するための手順書です。

> **この手順書の使い方（エージェントへ）**
> - 上から順に実行する。各ステップ末尾の「✅ 検証」で期待どおりの出力を**必ず確認してから**次へ進む。
> - `👤 人間の操作が必要` マークの付いたステップは、ブラウザ認証などエージェント単独では完結できない。ユーザーに依頼する。
> - コマンドはローカル（Windows / PowerShell）から `ssh エイリアス "..."` で VPS に投げる形式で統一している。
> - 破壊的操作（既存 `marin-pdf-web` コンテナや `marin` ノードを止める等）は**絶対にしない**。この手順は「追加」だけを行う。

最終更新: 2026-07-01（VPS 実機で SSH 疎通・既存構成・`/dev/net/tun`・リソースを確認済み）

---

## 0. 全体像（何をするのか）

```
                         Hostinger VPS (31.97.109.137 / srv1508169 / Ubuntu 24.04)
                         ┌──────────────────────────────────────────────────────┐
   marin.tailaa1b31 ─────┤ [ホスト常駐 tailscaled] ── Funnel :443 → localhost:5173 │ (既存: marin-pdf-web) ← 触らない
                         │                                                        │
 <新URL>.tailaa1b31 ─────┤ [Docker: tailscale-<PROJECT>] ─ Funnel :443 → :<PORT>  │ (今回追加するアプリ)
                         └──────────────────────────────────────────────────────┘
```

- **Tailscale は 1 ノード = 1 ホスト名 = 1 URL**。既存 `marin` の URL を変えずに 2 個目の URL を持つには、
  **同じ VPS 内にもう 1 つ Tailscale ノードを立てる**のが正攻法。
- 2 個目のノードは **Docker コンテナ（`tailscale/tailscale` イメージ）** として起動する。
  既存の docker-compose 運用と同じ流儀で、`restart: unless-stopped` により自動復旧する。
- 結果として **`marin.tailaa1b31.ts.net`（既存）と `<新URL>.tailaa1b31.ts.net`（新規）が同時に生きる**。

---

## 1. VPS 基本情報

| 項目 | 値 |
|---|---|
| プロバイダ | Hostinger (Indonesia-Jakarta) |
| ホスト名 | `srv1508169` |
| 固定 IP | `31.97.109.137` |
| OS | Ubuntu 24.04 |
| Docker | インストール済み（`sg docker -c '...'` でラップして使う。後述） |
| 運用ユーザ | `lineworks` (uid 1001) |
| tailnet | `lineworks-local.info` |
| MagicDNS サフィックス | `tailaa1b31.ts.net` |
| 既存ノード | `marin`（Tailscale IP `100.123.183.63` / URL `https://marin.tailaa1b31.ts.net`） |
| 空きリソース | RAM 空き 13GB / ディスク空き 169GB（十分） |

---

## 2. SSH 接続方法（最重要）

### 2-1. 鍵の保管場所

| 種別 | パス |
|---|---|
| SSH config | `C:\Users\imaizumi.LINEWORKS-NET\.ssh\config` |
| 秘密鍵 | `C:\Users\imaizumi.LINEWORKS-NET\.ssh\.ssh_LINEWORKS\id_ed25519`（419 bytes, ed25519） |
| 公開鍵 | `C:\Users\imaizumi.LINEWORKS-NET\.ssh\.ssh_LINEWORKS\id_ed25519.pub` |
| known_hosts | `C:\Users\imaizumi.LINEWORKS-NET\.ssh\.ssh_LINEWORKS\known_hosts` |
| 詳細メモ（原本） | `C:\Users\imaizumi.LINEWORKS-NET\Documents\材料取りCADソフト\lineworks-vps-ssh-info.md` |

### 2-2. 登録済みエイリアス（`~/.ssh/config`）

```sshconfig
Host lineworks-vps
    HostName 31.97.109.137
    User root
    IdentityFile ~/.ssh/.ssh_LINEWORKS/id_ed25519
    IdentitiesOnly yes
    ServerAliveInterval 60

Host lineworks-vps-user
    HostName 31.97.109.137
    User lineworks
    IdentityFile ~/.ssh/.ssh_LINEWORKS/id_ed25519
    IdentitiesOnly yes
    ServerAliveInterval 60
```

- **`lineworks-vps`** … `root` として接続（Tailscale の serve/funnel 設定など root 権限が要る作業用）
- **`lineworks-vps-user`** … `lineworks` ユーザとして接続（**運用作業・docker はこちら推奨**）

### 2-3. 接続例

```powershell
ssh lineworks-vps-user "whoami; hostname"    # => lineworks / srv1508169
ssh lineworks-vps "tailscale status --self --peers=false"
```

### 2-4. 🚨 やってはいけないこと

- ❌ `ssh root@31.97.109.137` のように **IP 直叩きしない**（IdentityFile が読まれず Permission denied になる）。必ずエイリアス経由。
- ❌ 鍵ファイルを他フォルダにコピーしない（権限が崩れる）。
- ❌ `~/.ssh/config` のエイリアス名を変更しない（他スクリプトが依存）。
- ❌ 既存の `marin-pdf-web` コンテナ・`marin` ノード・そのポート 5173 を停止/変更しない。

### 2-5. ✅ 検証（ここを通してから先へ）

```powershell
ssh lineworks-vps-user "echo CONNECTED_OK; hostname"
```
→ `CONNECTED_OK` と `srv1508169` が返れば SSH 疎通 OK。

> **docker コマンドの注意**: SSH 経由だと `lineworks` の docker group が即時反映されない。
> docker を叩くときは**必ず `sg docker -c '...'` でラップする**。
> 例: `ssh lineworks-vps-user "sg docker -c 'docker ps'"`

---

## 3. 事前に決める値（プレースホルダ）

この手順書のコマンドに出てくる `<...>` を、デプロイするアプリに合わせて最初に確定させる。
**以降のコマンドをコピーする前に、必ず自分の値へ置換すること。**

| プレースホルダ | 意味 | 例 | 決め方 / 制約 |
|---|---|---|---|
| `<PROJECT>` | プロジェクト短縮名（英小文字・数字・ハイフンのみ） | `worklog` | ディレクトリ名やコンテナ名に使う |
| `<TS_HOSTNAME>` | 2 個目ノードのホスト名 = **URL のサブドメイン** | `worklog` | **tailnet 内で未使用の名前**にする（§5-1 で確認）。`marin` は不可 |
| `<PORT>` | アプリが VPS の**ホスト側**で待ち受けるポート | `5174` | **5173 は marin が使用中**。5174 以降の空きを使う |
| `<REPO_URL>` | アプリの GitHub リポジトリ | `https://github.com/skyblueearthjapan/xxx.git` | Private 可 |
| `<APP_DIR>` | VPS 上の配置先 | `/opt/<PROJECT>` | 例 `/opt/worklog` |

> 確定 URL は **`https://<TS_HOSTNAME>.tailaa1b31.ts.net`** になる。

### ✅ ポート衝突チェック

```powershell
ssh lineworks-vps-user "ss -ltn | grep -E ':(5173|<PORT>)\b' || echo 'PORT free'"
```
→ `<PORT>` の行が出てこなければ（`PORT free` 表示なら）そのポートは空き。5173 は marin なので必ず出る（正常）。

---

## 4. Step 1 — アプリを VPS に配置して起動

> アプリ本体を Docker で起動し、**ホストの `<PORT>` で HTTP 200 が返る**状態にする。
> （Vite 系フロントなら既存 `marin-pdf` の構成が手本。`server.host: '0.0.0.0'` / `allowedHosts: true` / `hmr: false` を必ず入れる。理由は §9 参照）

### 4-1. アプリ側の必須設定（コミット前にローカルで確認）

Vite を使う場合、`vite.config.ts` は最低限こうする（Funnel 経由公開の必須条件）:

```ts
export default defineConfig({
  server: {
    host: '0.0.0.0',        // Docker 経由アクセスに必須
    port: <PORT>,           // 5173 以外の空きポート
    strictPort: true,
    allowedHosts: true,     // Funnel 経由ホストの 403 防止（必須）
    hmr: false,             // Funnel 経由の SSL 不一致による大量エラー防止
  },
});
```

`docker-compose.yml`（アプリ本体。ポートだけ `<PORT>` に変える）:

```yaml
services:
  web:
    build: { context: ., dockerfile: Dockerfile }
    image: <PROJECT>-web:dev
    container_name: <PROJECT>-web
    ports:
      - "<PORT>:<PORT>"
    volumes:
      - ./:/app
      - /app/node_modules       # node_modules を匿名ボリュームで保護
      - /app/.git               # .git を隠す（Vite が .git/objects を JS として誤読するのを防ぐ）
    environment:
      - CHOKIDAR_USEPOLLING=true
      - WATCHPACK_POLLING=true
    restart: unless-stopped
```

### 4-2. VPS へ配置・起動

```powershell
# ディレクトリ作成（root 権限）
ssh lineworks-vps "mkdir -p <APP_DIR> && chown lineworks:lineworks <APP_DIR>"

# clone（lineworks ユーザ）
ssh lineworks-vps-user "cd <APP_DIR> && git clone <REPO_URL> ."

# 起動（sg docker ラップ必須）
ssh lineworks-vps-user "cd <APP_DIR> && sg docker -c 'docker compose up -d --build'"
```

初回ビルドは npm install で 1〜3 分。

### 4-3. ✅ 検証（内部疎通）

```powershell
ssh lineworks-vps-user "sg docker -c 'docker ps --format \"{{.Names}}\t{{.Status}}\"' | grep <PROJECT>"
ssh lineworks-vps-user "curl -sI http://localhost:<PORT>/ | head -1"
```
→ コンテナが `Up` かつ `HTTP/1.1 200 OK` が返れば Step 1 完了。
返らない場合: `ssh lineworks-vps-user "sg docker -c 'docker logs <PROJECT>-web --tail 50'"`

---

## 5. Step 2 — 2 個目の Tailscale ノードを Docker で起動

ここが本題。既存 `marin` に触れず、`tailscale/tailscale` コンテナを**新しいノード**として参加させ、
`<PORT>` のアプリを `https://<TS_HOSTNAME>.tailaa1b31.ts.net` として Funnel 公開する。

### 5-1. 👤 人間の操作: Auth キーの発行 & ホスト名の空き確認

**（A）ホスト名の空き確認**（エージェントが実行可）:
```powershell
ssh lineworks-vps "tailscale status --json | grep -i '\"HostName\"' | sort | uniq -c"
```
→ 一覧に `<TS_HOSTNAME>` が出てこなければ未使用。出てくる場合は別名にする。
（`funnel-ingress-node` と `marin` は既存。無視してよい）

**（B）👤 Auth キーの発行**（ユーザーがブラウザで実施）:
1. https://login.tailscale.com/admin/settings/keys を開く（tailnet `lineworks-local.info` の管理者でログイン）
2. **Generate auth key** をクリック
3. 推奨設定: **Reusable = OFF**、**Ephemeral = OFF**（サーバ常駐なので永続）、**Tags** は任意
4. 生成された `tskey-auth-xxxxxxxx...` を控える（**このキーは一度しか表示されない**）

> エージェントは、このキーをユーザーから受け取るまで §5-3 に進めない。
> キーはコマンド履歴やコミットに残さない（下記のとおり VPS 上の `.env` に書き、`.gitignore` 済みにする）。

### 5-2. serve 設定ファイルを作成（Funnel の中身）

VPS 上の `<APP_DIR>` に `ts-<PROJECT>-serve.json` を作る。`${TS_CERT_DOMAIN}` は
コンテナが自ノードの FQDN（= `<TS_HOSTNAME>.tailaa1b31.ts.net`）へ自動展開するプレースホルダなので**このまま書く**。

```powershell
ssh lineworks-vps-user "cat > <APP_DIR>/ts-<PROJECT>-serve.json <<'JSON'
{
  \"TCP\": { \"443\": { \"HTTPS\": true } },
  \"Web\": {
    \"\${TS_CERT_DOMAIN}:443\": {
      \"Handlers\": { \"/\": { \"Proxy\": \"http://127.0.0.1:<PORT>\" } }
    }
  },
  \"AllowFunnel\": { \"\${TS_CERT_DOMAIN}:443\": true }
}
JSON"
```

> ⚠️ heredoc 内の `${TS_CERT_DOMAIN}` の `$` は**エスケープ（`\$`）してリテラルのまま**ファイルに残すこと。
> 作成後、中身を確認: `ssh lineworks-vps-user "cat <APP_DIR>/ts-<PROJECT>-serve.json"`
> → `${TS_CERT_DOMAIN}` の文字列がそのまま入っていれば正しい。

### 5-3. Tailscale サイドカー用 compose ファイルを作成

`<APP_DIR>/docker-compose.tailscale.yml` を作る（アプリ本体の compose とは**別ファイル**にして独立管理する）:

```powershell
ssh lineworks-vps-user "cat > <APP_DIR>/docker-compose.tailscale.yml <<'YAML'
services:
  tailscale-<PROJECT>:
    image: tailscale/tailscale:latest
    container_name: tailscale-<PROJECT>
    hostname: <TS_HOSTNAME>
    network_mode: host
    environment:
      - TS_AUTHKEY=\${TS_AUTHKEY}
      - TS_HOSTNAME=<TS_HOSTNAME>
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_USERSPACE=true
      - TS_SERVE_CONFIG=/config/serve.json
      - TS_EXTRA_ARGS=--reset
    volumes:
      - ./ts-<PROJECT>-state:/var/lib/tailscale
      - ./ts-<PROJECT>-serve.json:/config/serve.json:ro
    cap_add:
      - NET_ADMIN
    restart: unless-stopped
YAML"
```

Auth キーは環境変数で渡す。VPS 上に `.env` を作成（**コミット禁止**）:

```powershell
ssh lineworks-vps-user "cd <APP_DIR> && printf 'TS_AUTHKEY=%s\n' 'tskey-auth-ここに5-1で発行したキー' > .env.tailscale && chmod 600 .env.tailscale"
# .gitignore に追記（未登録なら）
ssh lineworks-vps-user "cd <APP_DIR> && grep -qxF '.env.tailscale' .gitignore || echo '.env.tailscale' >> .gitignore"
```

### 5-4. 起動

```powershell
ssh lineworks-vps-user "cd <APP_DIR> && sg docker -c 'docker compose --env-file .env.tailscale -f docker-compose.tailscale.yml up -d'"
```

### 5-5. ✅ 検証（ノード参加 & Funnel）

```powershell
# 起動ログ（認証成功と serve 反映を確認）
ssh lineworks-vps-user "sg docker -c 'docker logs tailscale-<PROJECT> --tail 40'"

# 新ノードが tailnet に参加したか（root で全体を見る）
ssh lineworks-vps "tailscale status | grep <TS_HOSTNAME>"
```
→ ログに認証エラーがなく、`status` に `<TS_HOSTNAME>` の行（新しい `100.x.y.z` IP 付き）が出れば参加成功。

> **もし `TS_AUTHKEY` を使わず対話ログインになった場合**（キー未設定など）:
> `docker logs` の中に `https://login.tailscale.com/a/xxxx` の認証 URL が出る。
> 👤 ユーザーがそれを開いて承認するとノードが参加する。

### 5-6. 👤 人間の操作: ノードの鍵失効を無効化（推奨）

サーバ常駐ノードは、既定の鍵失効（数か月）で落ちると URL が死ぬ。管理コンソールで無効化する:
1. https://login.tailscale.com/admin/machines を開く
2. `<TS_HOSTNAME>` の行の `⋯` → **Disable key expiry**

---

## 6. Step 3 — 外部公開の確認（Funnel）

§5-3 の `TS_SERVE_CONFIG`（serve.json）に `AllowFunnel: true` を入れているので、
コンテナ起動時点で **Funnel（インターネット公開）まで自動で有効**になっている。追加コマンドは基本不要。

### ✅ 検証（外部疎通）

```powershell
# 新ノードから見た Funnel 状態（root）
ssh lineworks-vps "tailscale funnel status"
```
→ `https://<TS_HOSTNAME>.tailaa1b31.ts.net` が `Funnel on` で `/ proxy http://127.0.0.1:<PORT>` になっていれば OK。

```powershell
# 外部（インターネット）から実アクセス
curl.exe -sI https://<TS_HOSTNAME>.tailaa1b31.ts.net/
```
→ `HTTP/2 200`（初回は TLS 証明書発行のため数秒〜十数秒かかることがある。数回リトライ可）。

> **`Funnel not available` / 403 が出る場合** → その tailnet でこのノードに Funnel 権限が無い。
> 👤 管理コンソール（Access Controls / ACL）の `nodeAttrs` に `funnel` 属性が
> このノード（またはそのユーザ/タグ）へ付与されているか確認。`marin` は付いているので、
> 同ユーザなら通常は継承される。

---

## 7. Step 4 — 完了確認チェックリスト

```powershell
# ① アプリ本体コンテナ稼働
ssh lineworks-vps-user "sg docker -c 'docker ps' | grep <PROJECT>-web"
# ② Tailscale サイドカー稼働
ssh lineworks-vps-user "sg docker -c 'docker ps' | grep tailscale-<PROJECT>"
# ③ 内部疎通
ssh lineworks-vps-user "curl -sI http://localhost:<PORT>/ | head -1"      # HTTP/1.1 200 OK
# ④ 外部疎通
curl.exe -sI https://<TS_HOSTNAME>.tailaa1b31.ts.net/                     # HTTP/2 200
# ⑤ 既存 marin が無傷（回帰チェック）
curl.exe -sI https://marin.tailaa1b31.ts.net/                             # HTTP/2 200（変わらず生きている）
```

①〜⑤ が全部 OK なら完了。ユーザーへ:

> 新しい URL: **https://<TS_HOSTNAME>.tailaa1b31.ts.net**
> （既存の marin.tailaa1b31.ts.net はそのまま利用可能）

---

## 8. 更新デプロイ（今後の運用）

ローカルで実装 → commit → push した後、VPS 側は 1 コマンドで反映:

```powershell
# アプリのコード更新（フロントのみなら restart で十分速い）
ssh lineworks-vps-user "cd <APP_DIR> && git pull && sg docker -c 'docker compose restart web'"

# 依存関係やビルドが変わったとき
ssh lineworks-vps-user "cd <APP_DIR> && git pull && sg docker -c 'docker compose up -d --build'"
```

> Tailscale サイドカー（`docker-compose.tailscale.yml`）は**アプリ更新では触らない**。
> ノード設定を変えたときだけ `docker compose -f docker-compose.tailscale.yml up -d` し直す。

---

## 9. トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| `permission denied ... docker API` | `sg docker -c '...'` ラップを忘れた。SSH 経由では docker group が即時反映されない。 |
| Vite が `Blocked request. This host is not allowed` / 403 | `vite.config.ts` の `allowedHosts: true` が抜けている。 |
| コンソールに `ERR_SSL_PROTOCOL_ERROR` 大量 | Vite HMR が wss で繋ごうとしている。`hmr: false` にする。 |
| 外部から 502/504 | アプリ（`<PORT>`）が起動していない。§4-3 の内部疎通を先に通す。`docker logs <PROJECT>-web`。 |
| `curl https://<TS_HOSTNAME>...` が繋がらない | ①ノード未参加（§5-5）②Funnel 未許可（§6 の注記）③証明書発行待ち（数秒リトライ）のいずれか。 |
| `Funnel not available` | tailnet ACL の `nodeAttrs` に `funnel` が無い。👤 管理コンソールで付与。 |
| serve.json が効かない | `${TS_CERT_DOMAIN}` がリテラルで入っているか確認（`$` をエスケープし忘れて空展開していないか）。 |
| ノードが数か月後に消えた | 鍵失効。§5-6 の Disable key expiry を実施していなかった。再度 auth key で up し直す。 |
| Vite が `.git/objects` を JS として誤読しオーバーレイエラー | アプリ compose の volumes に `/app/.git` を追加して .git を隠す（§4-1）。 |

---

## 10. 落とし穴チェックリスト（marin で実証済み・今回も同じ罠）

1. **`sg docker -c` ラップ必須**（PowerShell SSH → docker group 即時反映なし）
2. **`allowedHosts: true`**（Funnel 経由ホストの 403 防止）
3. **`hmr: false`**（Funnel 経由は SSL 不一致で HMR 不可）
4. **`host: '0.0.0.0'`**（Docker 内アプリを外部から見るため）
5. **`CHOKIDAR_USEPOLLING=true` / `WATCHPACK_POLLING=true`**（Docker volume のファイル変更検知）
6. **匿名ボリュームで `/app/node_modules` と `/app/.git` を保護**
7. **ポートは 5173 を避けて `<PORT>` = 5174 以降**（5173 は marin 占有）
8. **`<TS_HOSTNAME>` は tailnet 内で未使用の名前**（`marin` は不可）
9. **Auth キー / `.env.tailscale` はコミットしない**（`.gitignore` 済みを確認）
10. **既存 `marin` ノード・コンテナ・ポート 5173 には一切触らない**（追加のみ）

---

## 付録 A. Docker を使わないネイティブ tailscaled 版（代替手段）

Docker サイドカーが使えない事情があるとき用。root で 2 つ目の tailscaled を別 state/socket で起動する。

```bash
# root で実行（ssh lineworks-vps）
sudo mkdir -p /var/lib/tailscale-<PROJECT> /run/tailscale-<PROJECT>
sudo tailscaled --tun=userspace-networking \
  --state=/var/lib/tailscale-<PROJECT>/tailscaled.state \
  --socket=/run/tailscale-<PROJECT>/tailscaled.sock \
  --port=0 &
sudo tailscale --socket=/run/tailscale-<PROJECT>/tailscaled.sock up --hostname=<TS_HOSTNAME>
sudo tailscale --socket=/run/tailscale-<PROJECT>/tailscaled.sock funnel --bg --https=443 http://localhost:<PORT>
```

> この方式は生プロセスなので再起動耐性がない。恒久運用するなら systemd ユニット化すること。
> 通常は本編（Docker サイドカー = `restart: unless-stopped` で自動復旧）を推奨。

---

## 付録 B. 参考: 既存 marin デプロイ手順書

同一 VPS への Vite + Docker + Tailscale Funnel の実績構成:
`C:\Users\imaizumi.LINEWORKS-NET\Documents\Marin-PDF-Workspace\DEPLOY-VPS.md`
（allowedHosts / hmr / font 等の罠の解決が記録されている。困ったら参照）

---

以上。この手順書どおりに進めれば、`marin` を止めずに 2 個目の URL でアプリを公開できる。
不明点は各ステップの「✅ 検証」で必ず立ち止まり、期待出力を確認してから次へ進むこと。

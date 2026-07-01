# Work Report

作業報告書に関するツール群を管理するリポジトリです。GitHub と Google Apps Script（スプレッドシートバインド型）を [clasp](https://github.com/google/clasp) 経由で連携して管理します。

## 構成

```
Work Report/
├── src/                 # GAS プロジェクト（clasp rootDir）
│   ├── Code.js
│   └── appsscript.json
├── Sampledata/          # 作業報告書のサンプル PDF / Excel
├── .clasp.json          # GAS プロジェクトとのリンク（scriptId）
├── .gitignore
└── README.md
```

## GAS プロジェクト

- **スクリプトID**: `1t7Oefa1OFg929nOJraIN460MuzU4Yx_ASvRWvDTb_yDwATj9t3OuAm4M`
- **エディタ**: https://script.google.com/home/projects/1t7Oefa1OFg929nOJraIN460MuzU4Yx_ASvRWvDTb_yDwATj9t3OuAm4M/edit
- **種別**: スプレッドシートバインド型
- **タイムゾーン**: Asia/Tokyo / ランタイム: V8

## clasp の使い方

初回のみ認証が必要です（`imaizumi@lineworks-local.info`）:

```bash
clasp login
```

### リモート（GAS）→ ローカルへ取得

```bash
clasp pull
```

### ローカル → リモート（GAS）へ反映

```bash
clasp push
```

> `.clasp.json` の `rootDir` が `src` を指しているため、GAS のファイルは `src/` 配下で管理します。

## 開発フロー

1. `clasp pull` で最新の GAS コードを取得
2. `src/` 配下でコードを編集
3. `clasp push` で GAS へ反映
4. `git add` / `git commit` / `git push` で GitHub に履歴を保存

## 注意

- 認証情報 `.clasprc.json` は `.gitignore` 済み（コミットしないこと）
- `.clasp.json` の `scriptId` は秘匿情報ではないためコミット対象

# デジタル作業報告書アプリ（VPS版） Node ランタイム
FROM node:20-bookworm-slim

WORKDIR /app

# better-sqlite3 の native ビルド用ツール（プリビルド無い場合の保険）
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# 依存だけ先に入れてレイヤキャッシュを効かせる
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# アプリ本体
COPY server ./server
COPY web ./web

ENV PORT=5174
EXPOSE 5174

CMD ["node", "server/index.js"]

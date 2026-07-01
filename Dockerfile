# デジタル作業報告書アプリ（VPS版） Node ランタイム
FROM node:20-bookworm-slim

WORKDIR /app

# 依存だけ先に入れてレイヤキャッシュを効かせる
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# アプリ本体
COPY server ./server
COPY web ./web

ENV PORT=5174
EXPOSE 5174

CMD ["node", "server/index.js"]

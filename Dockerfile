# Node.js 24 LTS: better-sqlite3のネイティブビルドに備えた依存関係ステージ
FROM node:24-bookworm-slim AS dependencies

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# 実行用イメージにはビルドツールを含めない
FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# ポート3000を公開（WebUI用）
EXPOSE 3000

# アプリケーションを起動
CMD ["node", "src/index.js"]

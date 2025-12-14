# Node.js 20 LTS (Alpine)
FROM node:20-alpine

# 作業ディレクトリを設定
WORKDIR /app

# package.jsonとpackage-lock.jsonをコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm install --production

# アプリケーションのソースをコピー
COPY . .

# ポート3000を公開（WebUI用）
EXPOSE 3000

# アプリケーションを起動
CMD ["node", "src/index.js"]

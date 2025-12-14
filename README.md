# Discord Supporter Bot

Node.js製のDiscord Botアプリケーション。メンバー募集メッセージの自動検出、ゲームチャンネルでの自動ロール付与、投票機能を提供します。

## 機能

### 1. メッセージ分析と自動応答
- **メンション応答**: Botがメンションされると「はーい」と返事をします
- **募集メッセージ検出**: OpenAI GPT-4o-miniを使用してメンバー募集メッセージを自動検知
  - RAG（Retrieval-Augmented Generation）方式でCSVデータを参考に判断
  - 募集メッセージと判断された場合、チャンネル名と同じロールにメンションして通知
  - 検出理由はCSVログファイルに自動保存（タイムスタンプ、チャンネル、メッセージ、判定結果、理由を記録）

### 2. 自動ロール割り当て
- **ゲームチャンネルでの自動ロール付与**: 設定されたカテゴリ内のチャンネルでメッセージ送信やリアクション追加を行うと、チャンネル名と同じロールが自動的に割り当てられます
- **ロールの自動作成**: 該当するロールが存在しない場合は自動的に作成されます

### 3. スラッシュコマンド
- **/vote コマンド**: 投票機能を提供
  - `title`: 投票のタイトル（必須）
  - `vote_period`: 投票受付期間（時間単位、デフォルト24時間）
  - `allow_multi_select`: 複数選択を許可するか（デフォルトtrue）
  - `candidate`: 候補（スペース区切りで複数指定、必須）

### 4. WebUI管理画面
- **CSV編集機能**: ブラウザから `recruitment_data.csv` を編集可能
- **データ統計表示**: 総データ数、募集/非募集メッセージの内訳を表示
- **リアルタイム編集**: データの追加、編集、削除、保存がブラウザ上で完結
- **アクセス**: `http://localhost:3000` （デフォルト）
- **ログ閲覧**: 募集メッセージ検出ログをタブで表示

### 5. チャンネル作成時の自動メッセージ
- **初期メッセージ投稿**: 新しいチャンネルが作成されると、自動的に「ここは<チャンネル名>の遊び場」というメッセージを投稿
- **テキストチャンネルのみ対応**: ボイスチャンネルなどは除外

### 6. リマインド機能
- **返信でリマインド設定**: メッセージに返信で「リマインド」と入力すると、OpenAI APIでメッセージから日付を抽出
- **自動日時特定**: 「明日」「来週月曜日」「12/25」などの表現を認識して絶対日時に変換
- **12:00に通知**: 特定された日の12:00（正午）にメンションでリマインド
- **データ永続化**: `reminders.json` に保存され、Bot再起動後も有効

## セットアップ

### 必要要件
- Node.js 18.x 以上
- Discord Bot トークン
- OpenAI API キー

### インストール手順

1. **依存関係をインストール**
   ```bash
   npm install
   ```

2. **設定ファイルを作成**
   ```bash
   cp config.example.json config.json
   ```

3. **config.jsonを編集**
   ```json
   {
     "discord": {
       "token": "YOUR_DISCORD_BOT_TOKEN_HERE",
       "clientId": "YOUR_CLIENT_ID_HERE"
     },
     "openai": {
       "apiKey": "YOUR_OPENAI_API_KEY_HERE",
       "model": "gpt-4o-mini"
     },
     "features": {
       "recruitmentDetection": {
         "enabled": true,
         "csvPath": "./recruitment_data.csv",
         "logPath": "./recruitment_log.csv"
       },
       "autoRole": {
         "enabled": true,
         "gameCategoryName": "ゲームチャンネル"
       },
       "mention": {
         "enabled": true,
         "response": "はーい"
       }
     },
     "webui": {
       "enabled": true,
       "port": 3000
     }
   }
   ```

4. **募集データCSVを準備**
   
   `recruitment_data.csv` は以下の形式で作成してください：
   ```csv
   message,is_recruitment,reason
   一緒にApexやりませんか？,true,ゲームの募集を明示的に呼びかけている
   今日は疲れました,false,単なる日常報告で募集要素がない
   ```

   サンプルファイルが既に含まれているので、そのまま使用または編集できます。

### WebUI管理画面の使用

1. **Botを起動**
   ```bash
   npm start
   ```

2. **ブラウザでアクセス**
   ```
   http://localhost:3000
   ```

3. **データを編集**
   - ➕ **新規追加**: 新しい学習データを追加
   - 📝 **編集**: 既存データを直接編集
   - 🗑️ **削除**: 不要なデータを削除
   - 💾 **保存**: 変更をCSVファイルに保存
   - 🔄 **再読み込み**: ファイルから最新データを読み込み

### Discord Bot の設定

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. Bot を作成してトークンを取得
3. Bot に以下の権限を付与：
   - `Send Messages`
   - `Read Message History`
   - `Add Reactions`
   - `Manage Roles`
   - `Use Slash Commands`
4. Bot を招待する際は以下のスコープを選択：
   - `bot`
   - `applications.commands`
5. Privileged Gateway Intents を有効化：
   - `MESSAGE CONTENT INTENT`
   - `SERVER MEMBERS INTENT`

## 起動方法

```bash
npm start
```

開発モード（ファイル変更時に自動再起動）：
```bash
npm run dev
```

## プロジェクト構造

```
DiscordSupporter_AI/
├── package.json                    # プロジェクト設定
├── config.example.json             # 設定ファイルのテンプレート
├── config.json                     # 実際の設定ファイル（Git管理外）
├── recruitment_data.csv            # RAG用の募集メッセージサンプル
├── recruitment_log.csv             # 募集検出ログ（Git管理外）
├── README.md
├── public/                         # WebUI静的ファイル
│   └── index.html                  # CSV編集UI
└── src/
    ├── index.js                    # エントリーポイント
    ├── bot.js                      # Bot初期化・起動
    ├── config/
    │   └── configLoader.js         # 設定読み込み
    ├── handlers/
    │   ├── messageHandler.js       # メッセージイベント処理
    │   ├── reactionHandler.js      # リアクションイベント処理
    │   └── interactionHandler.js   # スラッシュコマンド処理
    ├── commands/
    │   └── vote.js                 # 投票コマンド
    ├── services/
    │   ├── openaiService.js        # OpenAI API統合
    │   ├── recruitmentDetector.js  # 募集メッセージ検出
    │   ├── roleManager.js          # ロール管理
    │   └── webServer.js            # WebUIサーバー
    └── utils/
        ├── csvLoader.js            # CSVデータ読み込み
        └── logger.js               # ロギング
```

## Ubuntu サーバーでの常設運用

### systemd サービスとして登録

1. **サービスファイルを作成**
   ```bash
   sudo nano /etc/systemd/system/discord-bot.service
   ```

2. **以下の内容を記述**
   ```ini
   [Unit]
   Description=Discord Supporter Bot
   After=network.target

   [Service]
   Type=simple
   User=your-username
   WorkingDirectory=/path/to/DiscordSupporter_AI
   ExecStart=/usr/bin/node src/index.js
   Restart=always
   RestartSec=10

   [Install]
   WantedBy=multi-user.target
   ```

3. **サービスを有効化して起動**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable discord-bot
   sudo systemctl start discord-bot
   ```

4. **ステータス確認**
   ```bash
   sudo systemctl status discord-bot
   ```

5. **ログ確認**
   ```bash
   sudo journalctl -u discord-bot -f
   ```

## カスタマイズ

### ゲームチャンネルカテゴリ名の変更

`config.json` の `features.autoRole.gameCategoryName` を変更：
```json
"autoRole": {
  "enabled": true,
  "gameCategoryName": "あなたのカテゴリ名"
}
```

### メンション応答の変更

`config.json` の `features.mention.response` を変更：
```json
"mention": {
  "enabled": true,
  "response": "呼びましたか？"
}
```

### 機能の無効化

各機能は `config.json` で個別に無効化できます：
```json
"features": {
  "recruitmentDetection": {
    "enabled": false
  }
}
```

## トラブルシューティング

### Bot がオンラインにならない
- `config.json` のトークンが正しいか確認
- Discord Developer Portal で Bot が有効になっているか確認

### 募集メッセージが検出されない
- OpenAI API キーが正しいか確認
- `recruitment_data.csv` が正しい形式か確認
- APIクォータが残っているか確認

### ロールが付与されない
- Bot がロール管理権限を持っているか確認
- Bot のロールが付与したいロールより上位にあるか確認
- カテゴリ名が `config.json` の設定と一致しているか確認

### スラッシュコマンドが表示されない
- `discord.clientId` が正しいか確認
- Bot に `applications.commands` スコープが付与されているか確認
- コマンド登録後、数分待ってから再試行

## ライセンス

MIT

## 今後の拡張案

- データベース統合（投票データの永続化）
- Webダッシュボード（管理UI）
- より高度な統計機能
- カスタムコマンドの追加
- 多言語サポート

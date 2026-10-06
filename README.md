# Discord Supporter Bot

現在の仕様の正本は [docs/spec/application.md](docs/spec/application.md)、テスト方針は [docs/spec/testing.md](docs/spec/testing.md) を参照してください。設計判断の履歴（ADR）は [docs/adr/](docs/adr/README.md) に分けて保存します。更新方法は [文書運用](docs/README.md) にまとめています。

## ゲームチャンネル管理（初回設定）

ゲームチャンネルの活動状況を記録し、管理者がDiscord上のパネルから安全にソフトアーカイブ・再稼働できます。ソフトアーカイブではチャンネルやロールを削除しません。

1. Botを起動する前に、`config.json`へSQLiteの保存先を追加します。

   ```json
   "database": {
     "path": "./data/discord-supporter.db"
   }
   ```

2. Botを起動し、サーバー管理権限を持つユーザーが次を実行します。

   ```text
   /game-admin setup
   ```

   - `game_category`: 稼働中ゲームのカテゴリ
   - `admin_channel`: 管理パネルを設置するテキストチャンネル
   - `dormant_days`: 休眠候補とする未活動日数（既定90日）
   - `archive_visibility`: 休止中チャンネルを閲覧のみ、または非表示にする設定

3. 管理パネルから休眠候補の確認、保留、対象外設定、アーカイブ、再稼働を操作します。

4. 一般メンバーから休止中ゲームの復帰希望を受け付ける場合は、次を実行します。

   ```text
   /game-admin member-panel
   ```

   - `channel`: 一般ユーザー用パネルを設置するテキストチャンネル
   - `restore_threshold`: 管理チャンネルへ通知する希望人数（既定5人）

   一般メンバーはパネルから、稼働中ゲームの「遊びたい」希望を複数選択で編集できます。選択内容はページごとに自動保存され、ゲームが休止中になっても削除されず、再稼働時に復元されます。

   同じパネルから、次の予定機能も利用できます。

   - `基本予定を編集`: 月曜〜日曜・祝日ごとに、普段参加できる時間帯を `○ / △ / × / 未入力` で登録します。
   - `予定・募集・確定予定を開く`: Discord Activity内で「予定入力／候補日確認／確定済み予定」を切り替えます。予定入力では今月・翌月の日曜始まりカレンダーでサーバー全員の予定を閲覧し、本人の予定だけを変更できます。候補日確認ではゲームを選び、今日以降の候補全件を昼／夜別の○△×人数で表示します。日付詳細にはゲーム希望者の名前と回答を表示し、一般メンバーも募集を投稿できます。確定済み予定ではリマインドで登録された予定を過去月も含めて確認でき、チャンネルの絞り込みと関連メンバーの予定を表示します。スマートフォンでは日付詳細が下部シートになります。
   - `月間予定（週表示）`: Activityの準備中・障害時にも使える従来の週単位編集です。
   - `候補日確認（従来表示）`: Activityの準備中・障害時にも使える候補確認です。稼働中ゲームの希望者の○△×人数を、当日以降の日付順（同日は昼、夜の順）で最大10件表示し、募集を送信できます。Activityでは10件の上限はありません。どちらも月間予定のタイムゾーン（通常はJST）で日付を判定します。

   募集メッセージはゲームロールへ通知し、最初から 👍（参加）、❌（参加不可）、サーバーのカスタム絵文字 `partyparrot`（開催確定）を付けます。👍と❌は後から押した方が有効になり、リアクションの追加・削除に合わせて参加者一覧を更新します。👍で参加表明しているメンバー、またはサーバー管理者が `partyparrot` を押すと一度だけ開催確定し、開催日の12:00に既存のリマインド機能で通知します。

   初期の予定枠は、平日が夜、土日祝が昼と夜です。開始時刻は日ごとに異なるため、予定画面と募集メッセージには固定時刻を表示しません。基本予定は月間予定の初期値として使われますが、すでに保存済みの日付は後から基本予定を変えても自動で上書きされません。週ごとの「基本予定に戻す」で、現在の基本予定を改めて反映できます。

   Activityの月間予定は同じサーバーの現在の非Botメンバー全員に共有されます。日付詳細では未入力と未登録を区別し、自分以外の予定は編集できません。今月内の過去日も編集でき、連続範囲を確認して基本予定へ戻せます。通常変更は自動保存され、他の人の変更は約5秒間隔で取得します。

   `連続予定変更`／`一括予定変更`を押し、同じ月内の開始日・終了日を順に選びます（両端を含み、同じ日を2回押せば1日だけ選択）。連続変更では各枠の予定を続けて入力し、一括変更では範囲内の昼・夜すべてに設定する○・△・×・未入力を選びます。どちらも`確定`を押すまで保存せず、確定時にまとめて保存します。未保存の変更をキャンセルすると破棄確認が表示されます。別端末で本人の予定が変わった場合は更新後に範囲を選び直してください。

   確定済み予定はリマインド通知後も保持されます。起動したサーバーで本人がチャンネルと履歴を閲覧できる予定だけを表示し、日付はサーバーのタイムゾーンで判定します。リマインド用の12:00はゲームの開始時刻として表示しません。

   ゲームの希望編集・復帰希望の操作画面は本人にだけ表示されます。候補日確認Activityでは、ゲーム希望者の名前とその日の○△×回答を同じサーバーのメンバーが閲覧できます。休止中ゲームの復帰希望が設定人数に達しても自動では再稼働せず、管理者の確認操作が必要です。

Botには少なくとも、チャンネルの閲覧・投稿・履歴閲覧・リアクションの追加・メッセージの管理・チャンネル管理・ロール管理権限が必要です。募集機能を使うサーバーには、名前が一意なカスタム絵文字 `partyparrot` も必要です。アーカイブ処理が中断した場合は`/game-admin repair`から元の稼働状態へ復旧できます。

### 月間予定Activityの有効化

Activityは既定で無効です。既存WebUIと同じサーバーへ配置し、次を準備します。

1. `npm ci` の後、`npm run build:activity` を実行します。生成先は `public/schedule/` です。Dockerイメージではビルド時に生成します。
2. `config.json` の `discord.clientSecret` と、32文字以上のランダムな `activity.sessionSecret` を設定します。`webui.enabled` と `activity.enabled` を `true` にします。セッションの既定有効期間は300秒です。
3. Developer PortalでActivityと対象プラットフォームを有効化し、URL Mappingを2件設定します。

   | Prefix | Target |
   | --- | --- |
   | `/api/activity/schedule` | `www.penguinone.net/discord/api/activity/schedule` |
   | `/` | `www.penguinone.net/discord/schedule` |

4. OAuth2のRedirect URIを登録します（Activity専用の公式例は `https://127.0.0.1`）。SDKの認可scopeは `identify` のみです。クライアントシークレットはブラウザーへ渡しません。
5. 再起動後、サーバーのメンバーパネルから起動して確認します。

公開ページは `https://www.penguinone.net/discord/schedule/` です。通常ブラウザーでは起動案内だけを表示し、予定は返しません。APIはOAuth本人・Activity起動元・現在所属を検証します。既存の管理用WebUI/APIは従来のアクセス制限を別途維持してください。

現行仕様は [仕様の正本](docs/spec/application.md) を参照してください。過去の [実装・運用手順書](docs/history/activity-schedule-runbook.md) と [検証結果](docs/history/activity-schedule-review.md) は当時の履歴として保持しています。

Node.js製のDiscord Botアプリケーション。メンバー募集メッセージの自動検出、ゲームチャンネルでの自動ロール付与、投票機能を提供します。

## 機能

### 1. メッセージ分析と自動応答
- **メンション応答**: Botがメンションされると「はーい」と返事をします
- **募集メッセージ検出**: 設定されたOpenAIまたはTypeSafe Jevを使用してメンバー募集メッセージを自動検知
  - OpenAI / TypeSafe Jevを設定で切り替え、検証済みのCSV判定例を参考に判断
  - 募集メッセージと判断された場合、チャンネル名と同じロールにメンションして通知
  - 検出結果をCSVログに自動保存（Jevの場合、理由列は空白）

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
- **データ永続化**: `data/reminders.json` に保存され、Bot再起動後も有効

## セットアップ

### 必要要件
- Node.js 24.x（`package.json` の engines に準拠）
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
       "model": "gpt-5.6-luna",
       "reasoningEffort": "none"
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

### 募集判定のOpenAI / Jev切り替え

`config.json` の `features.recruitmentDetection.provider` を `"jev"` にするとTypeSafe Jevを使います。未指定または `"openai"` は従来のOpenAIモデルです。設定変更にはBotの再起動が必要です。

`config.example.json` の `jev` セクションを既存設定に追加してください。

```json
{
  "jev": {
    "apiKey": "",
    "model": "jev-latest",
    "timeoutMs": 10000,
    "threshold": 0.8
  }
}
```

APIキーは `jev.apiKey` または環境変数 `TYPESAFE_API_KEY` に設定します（configの非空値を優先）。キーはコミットしないでください。モデルを固定する場合はTypeSafeで利用可能なモデルIDを指定します。Noulの確率がthreshold以上なら募集です。thresholdは0より大きく1以下、timeoutMsは100〜60000。既定の0.8は少数の開発用評価で引用文の誤通知を抑えるために選んだ値で、本番精度を保証するものではありません。

Jev使用時の検出ログの理由は空白です。APIエラーでは通知せず、通常の検出CSVに非募集として混ぜず、アプリログに記録します。他providerへ自動で切り替えません。リマインドの日付抽出には引き続きOpenAIを使うため、`openai.apiKey` も必要です。

判定例はモデルの再学習ではなく、各リクエストに渡す参考例です。最大32件、本文2000文字／理由500文字、合計16000文字。`is_recruitment` は `true` / `false` のみで、空本文・正規化後の重複・矛盾するラベルを拒否します。理由は空でも構いません。偏りの少ない代表例と境界例を人が確認して登録し、モデルの検出結果をそのまま正解として登録しないでください。上限超過は黙って切り捨てずエラーにします。WebUI保存は検証後にファイルと実行中の判定例を更新し、失敗時は直前の正常な状態を維持します。起動時にCSVが読めなければ警告して参考例なしで判定します。

精度比較の手順は [募集判定評価](evals/recruitment/README.md) を参照してください。

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
   - ➕ **新規追加**: 新しい判定例を追加
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
├── recruitment_data.csv            # few-shot用の募集メッセージ判定例
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

## Docker での運用 🐳

### メリット
- ✅ プロセス管理が簡単（ゾンビプロセスの心配なし）
- ✅ 環境の一貫性（どこでも同じように動作）
- ✅ 簡単な起動・停止・再起動
- ✅ ログ管理が統一的

### 前提条件
- Docker Desktop (Windows) または Docker Engine (Ubuntu)
- Docker Compose

### セットアップ

1. **設定ファイルを準備**
   ```bash
   cp config.example.json config.json
   # config.jsonを編集
   ```

2. **Dockerイメージをビルド**
   ```bash
   docker-compose build
   ```

3. **起動**
   ```bash
   docker-compose up -d
   ```

4. **ログ確認**
   ```bash
   docker-compose logs -f
   ```

5. **停止**
   ```bash
   docker-compose down
   ```

6. **再起動**
   ```bash
   docker-compose restart
   ```

### 便利なコマンド

```bash
# ステータス確認
docker-compose ps

# コンテナに入る
docker-compose exec discord-bot sh

# ログ確認（最新100行）
docker-compose logs --tail=100

# リアルタイムログ
docker-compose logs -f

# コンテナ削除して再ビルド
docker-compose down
docker-compose up -d --build
```

### データの永続化

以下のファイルはホストマシンとコンテナ間で共有されます：
- `config.json` - 設定ファイル（読み取り専用）
- `recruitment_data.csv` - 旧判定例の移行元（読み取り専用）
- `data/` - SQLite、リマインダー、カレンダー予定、活動キャッシュと検出ログ（ログの保存先は設定に従う）

Composeでは `RECRUITMENT_EXAMPLES_DIRECTORY=/app/data` を設定します。既存の `csvPath` が標準の `./recruitment_data.csv` の場合のみ、初回起動時に検証して `data/recruitment_data.csv` へコピーし、以降はそのファイルを編集・使用します。既に移行先があれば上書きしません。旧ファイルはそのまま残ります。これは単一ファイルのbind mountを置換できないための移行で、保存はディレクトリマウント内で行います。移行後のバックアップ・直接編集対象は `data/recruitment_data.csv` です。独自のcsvPathを使う場合はこの自動移行の対象外なので、書き込み可能なディレクトリマウント配下を指定してください。通常のNode.js起動では環境変数がなければcsvPathをそのまま使用します。

### WebUIへのアクセス

```
http://localhost:3000
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

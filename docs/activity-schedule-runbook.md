# Discord Activity 月間予定カレンダー実装・運用手順書

## 1. 前提

- 仕様は `docs/activity-schedule-specification.md` を正本とする。
- 実装は TDD で進め、各単位で失敗テストを確認してから実装する。
- 既存の予定テーブルと予定サービスを再利用する。
- Developer Portal、本番 DNS、リバースプロキシの変更は、ローカル実装とテスト完了後に行う。
- Discord クライアントシークレット、Activity セッション秘密値、Bot トークンをリポジトリへ保存しない。

## 2. 実装の順序

### 2.1 現行挙動の保護

1. 既存の月間予定・基本予定・候補日程テストを実行する。
2. Activity 追加前の挙動を示すテストが不足する箇所を追加する。
3. `git diff --check` と JavaScript 構文確認を行う。

### 2.2 共有予定の読み取りモデル

1. 現在の全非 Bot メンバーを完全に取得する共通処理の失敗テストを書く。
2. 対象月の基本予定を既存ルールで materialize する。
3. メンバー一覧と月間予定枠を突き合わせ、各メンバーの状態を返すリポジトリテストを書く。
4. `未入力` と `未登録` を区別し、予定枠ごとの合計が全メンバー数と一致するサービスを実装する。
5. 退会者、Bot、不完全なメンバーキャッシュ、基本予定のみ登録済み、一部入力、明示的 `unset` をテストする。

### 2.3 直接更新と範囲復元

1. `○ / △ / × / 未入力` の直接指定が冪等であることを示す失敗テストを書く。
2. ギルド、月、日付、予定枠、本人 ID の改ざん拒否テストを書く。
3. 今月・翌月の制約と、今月内の過去日を許可する境界テストを書く。
4. 同月内の開始日・終了日検証と競合検出の失敗テストを書く。
5. 既存トランザクションを利用して範囲復元を実装する。

### 2.4 Activity 認証と API

1. 認可コード交換、セッション発行、有効期限、署名改ざんのユニットテストを書く。
2. OAuth で確定したユーザーが対象ギルドの現在の非 Bot メンバーであることを検証する。
3. Activity インスタンスを Discord 側で検証し、アプリケーション、起動ギルド、参加ユーザーが OAuth 結果と一致する場合だけセッションを発行する。
4. 認証なし、期限切れ、別ギルド、無効な Activity インスタンス、退会済み、Bot の API 拒否テストを書く。
5. 読み取り、単一枠更新、範囲復元 API のルートテストを書く。
6. API エラー形式と HTTP ステータスを統一する。
7. 認証 API と予定 API にレート制限、キャッシュ禁止、セキュリティヘッダーを設定する。

### 2.5 Activity フロントエンド

1. 日曜始まりの月グリッド、月外日、うるう年、今月・翌月切替のテストを書く。
2. 人数集計、日付詳細、本人行だけの編集操作、未入力・未登録の表示テストを書く。
3. 範囲選択、確認、競合、保存中・成功・失敗表示のテストを書く。
4. Discord Embedded App SDK の `ready`、`authorize`、`authenticate` を組み込む。
5. 通常ブラウザーでは予定 API を呼ばず、Discord 起動案内を表示する。
6. Focused 復帰時の再取得、自動更新、手動更新を実装する。
7. 768px、480px、代表的なスマートフォン幅でレスポンシブ表示を確認する。
8. キーボード、フォーカス、ARIA、Safe Area を確認する。

### 2.6 Discord 起動導線

1. 現在の週表示ボタンをフォールバックとして維持する。
2. メンバーパネルの「月間予定を編集」をActivity起動とし、「月間予定（週表示）」を別ボタンで残す。
3. ボタンの Interaction が Activity 起動応答を返すテストを書く。
4. Activity が無効または起動に失敗した場合に、フォールバックを案内する。
5. パネル説明を「同一サーバー内で予定を共有する」内容へ更新する。

## 3. ローカル設定

### 3.1 設定値

`config.json` に次の値を設定する。実際の値はコミットしない。

```json
{
  "discord": {
    "clientId": "APPLICATION_ID",
    "clientSecret": "APPLICATION_CLIENT_SECRET"
  },
  "activity": {
    "enabled": true,
    "sessionSecret": "LONG_RANDOM_SECRET",
    "sessionTtlSeconds": 300
  }
}
```

`config.example.json` にはプレースホルダーと説明だけを追加する。

### 3.2 依存関係

1. Activity SDK と、実装で採用するビルド・テスト依存を `package.json` へ追加する。
2. `npm ci` または lockfile を更新する適切な `npm install` を実行する。
3. 依存関係追加後に対象テストと全テストを再実行する。

### 3.3 ローカル起動

1. `npm ci`、`npm run build:activity` を実行し、Bot と WebUI を起動する。Dockerではイメージのビルド時にActivityも生成する。
2. `/schedule/` が通常ブラウザー向け案内を返すことを確認する。
3. `/api/activity/schedule/*` が認証なしで `401` を返すことを確認する。
4. Discord の開発用 Activity URL Mapping には、一時的な HTTPS トンネルまたは開発用公開 URL を設定する。
5. 開発用と本番用の Discord Application を可能な限り分離する。

## 4. 検証

### 4.1 自動テスト

```text
npm test -- tests/services/activityScheduleService.test.js
npm test -- tests/services/activityAuthService.test.js
npm test -- tests/activity
npm test -- tests/routes/activityScheduleRouter.test.js
npm test -- tests/services/activityWebServer.test.js
npm test -- tests/interactions/scheduleMemberInteractionHandler.test.js
npm test
```

実際のファイル名は実装時のタスク分解に合わせる。

### 4.2 静的確認

```text
git diff --check
node --check <変更した JavaScript ファイル>
```

秘密値、Bot トークン、OAuth アクセストークン、セッション値が差分やログに含まれていないことも確認する。

### 4.3 ブラウザー確認

- デスクトップ幅で今月・翌月、日付詳細、直接更新、範囲復元を確認する。
- 390px 前後のスマートフォン幅で 7 列、下部シート、Safe Area、タップ領域を確認する。
- Activity 外の直接アクセス、期限切れセッション、ネットワーク失敗を確認する。
- 2 ユーザーで開き、片方の変更がもう片方へ自動反映されることを確認する。
- 退会者と Bot が表示・集計されないことを確認する。

### 4.4 Discord 実機確認

- Discord Desktop、Discord Web、iOS、Androidで起動する。
- メンバーパネルから起動したギルドだけが表示される。
- PIP/Gridでは編集できず、Focusedへ戻る案内が出る。
- フォールバックの週表示が引き続き利用できる。

## 5. 本番配置

### 5.1 Web サーバーとリバースプロキシ

1. Express 内部の `/schedule/` を公開 URL `/discord/schedule/` へ転送する。
2. Express 内部の `/api/activity/schedule/` を公開 URL `/discord/api/activity/schedule/` へ転送する。
3. 静的ファイルは相対URL、APIはDiscord originの `/api/activity/schedule` を使用する。下記2件のURL Mappingを必ず設定する。
4. HTTPS、キャッシュ禁止、5秒間隔のHTTP自動更新を確認する。WebSocketは使用しない。Vite開発サーバーを本番公開しない。
5. Activity以外の既存管理APIはアプリ層では無認証のため、従来の管理者向けアクセス制限を維持する。今回の認証追加で既存APIまで保護されたとは扱わない。

### 5.2 Discord Developer Portal

1. 対象 Application で Activities を有効にする。
2. Supported Platforms で Web、iOS、Androidを有効にする。
3. Activity URL Mapping を設定する。
4. ページ用の `/` mapping は `www.penguinone.net/discord/schedule` ディレクトリを指す。
5. API用の `/api/activity/schedule` mapping を `www.penguinone.net/discord/api/activity/schedule` に必ず設定し、`/` より先に置く。Targetに `https://` は付けない。
6. Application URL Override は本番では無効にする。
7. Art Assets と Activity 名を設定する。
8. OAuth2のRedirect URIを登録する。Activity専用では公式サンプルの `https://127.0.0.1` を使用できる。SDK authorizeとActivity専用code交換には redirect_uri を渡さない。
9. OAuth scopeは `identify` のみ。Bot側でActivity Instanceのapplication、instance、guild channel、参加userを検証し、さらに現在の非Bot所属を強制取得する。
10. 古いDiscordでlayout購読が未対応の場合は更新案内を表示する。最新クライアントでFocused/PIP/Gridを確認する。
11. Activity有効化で作られるPrimary Entry Point（Launch）を確認する。Bot再起動時のコマンド同期は既存Entry Pointと翻訳・権限を保持する。取得できない場合は一括更新を中止し、存在しないEntry Pointを推測作成しない。

### 5.3 秘密値

1. 本番 `config.json` または秘密値管理へ Discord client secret と Activity session secret を設定する。
2. session secret は十分な長さの乱数とし、漏えい時にローテーションできるようにする。
3. WebUI、リバースプロキシ、Discord API のログに認可コードやトークンを残さない。

### 5.4 リリース

1. DB と設定ファイルをバックアップする。
2. 新バージョンを配置し、依存関係を lockfile どおりにインストールして `npm run build:activity` を実行する（Dockerでは自動）。
3. Bot と WebUI を再起動する。
4. ヘルスチェック、通常ブラウザー案内、未認証 API 拒否を確認する。
5. 開発用メンバーで Activity 認証、読み取り、本人更新、共有更新を確認する。
6. メンバーパネルを再同期し、新しい起動ボタンを反映する。
7. 問題時は旧週表示を案内し、Activity の `enabled` を無効化して切り戻す。

## 6. 完了条件

- 仕様書の全受け入れ条件を自動テストまたは実機確認で検証している。
- 全テストと静的確認が成功している。
- 本番固有の未実施項目が明確に記録されている。
- 既存機能の回帰がない。
- セキュリティレビューと差分全体レビューが完了している。

## 7. API契約

共通prefixは `/api/activity/schedule`（公開時は `/discord/api/activity/schedule`）。通常の予定操作は `Authorization: Bearer <短期セッション>` を要求する。Cookieやブラウザーストレージへ認証値は保存しない。

| Method / path | 入力 | 用途 |
| --- | --- | --- |
| GET `/bootstrap` | なし | 公開可能なclientIdと有効状態だけ |
| POST `/session` | code, instanceId | OAuth/Activity/所属検証、accessTokenと短期sessionToken発行 |
| GET `/month?offset=0` | offsetは0/1 | 月情報、今日、全枠集計、本人状態 |
| GET `/months/:monthId/days/:date` | 同月内の日付 | 名前順の全メンバー詳細（本人先頭） |
| PUT `/months/:monthId/slots/:slotId` | status | 本人枠の直接指定 |
| POST `/range-reset/preview` | monthId, startDate, endDate | 対象枠一覧とrevision |
| POST `/range-reset` | 上記 + revision | 原子的な範囲復元 |

本文のuserId/guildId等の余分なキーは拒否する。予定APIは全てキャッシュ禁止。認証コード交換は接続元IPあたり40回/分、認証後はユーザー・ギルドあたり240回/分を上限とし、超過はDiscord所属照会前に拒否する。リバースプロキシ配下のIP制限は共有される可能性がある。本文は8KB以下。

範囲revisionは本人・対象月・範囲・各回答（欠損を含む）・適用基本予定を含む。復元トランザクション内で再計算し、相違は409。月のupdated_atや対象外メンバーの変更では競合させない。

参照: [Discord Activity認証](https://docs.discord.com/developers/activities/building-an-activity)、[Activity Instance検証](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience)、[Layout](https://docs.discord.com/developers/activities/development-guides/layout)、[Mobile Safe Areas](https://docs.discord.com/developers/activities/development-guides/mobile)。

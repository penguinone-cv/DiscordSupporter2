# アプリケーション仕様（正本）

2026-09-12、`65bdf0e` の実装を基準とする。今回の整理では機能動作・DBスキーマを変更しない。関連判断: [ADR-0002](../adr/0002-application-boundaries.md)、[ADR-0003](../adr/0003-scheduling-and-recruitment.md)。

## APP-01 構成と保存先

- Node.js 24.x / ES Modules。Discord Botと任意のExpress WebUIを同じプロセスで起動する。
- `handlers` / `interactions` / `commands` が入口、`services` が業務処理、`repositories` がSQLiteアクセスを担う。Discord通信とSQLiteは単一トランザクションではない。
- 設定は `config.json`。Discord token/clientIdとOpenAI apiKeyが必須で、未設定や `YOUR_` の仮値は起動時検証で拒否する。設定・秘密情報の実値を文書に転記しない。
- ゲーム管理・活動・希望・予定・募集は `database.path` のSQLiteと `src/migrations/` で永続化する。
- リマインド、カレンダー予定、チャンネル活動キャッシュはそれぞれ `data/reminders.json`、`data/calendarEvents.json`、`data/channelActivity.json`。募集の参考データ・判定ログは設定されたCSVパスへ保存する。
- Docker Composeは `data/` を永続化し、`TZ=Asia/Tokyo` を設定する。投票はメモリ管理で再起動復元しない。

根拠: `package.json`、`src/index.js`、`src/bot.js`、`src/config/configLoader.js`、`src/repositories/database.js`、`docker-compose.yml`。

## APP-02 メッセージ・ロール・投票

- Bot投稿を自動応答・募集検出・自動ロール付与の対象から外す。活動記録ではBot投稿と人間投稿を区別する。
- メンション応答、募集検出、自動ロール付与はそれぞれ設定で有効化する。
- 募集検出は稼働中ゲームチャンネル、または設定された汎用募集チャンネルが対象。スレッドは対象外。ゲーム募集は対象ロール、汎用募集は `@everyone` へ通知する。
- CSVの募集／非募集例をOpenAIへの参考入力にする。判定失敗時は非募集として扱う。判定理由をCSVに記録する。モデル・reasoningは設定可能で、現行コードの既定値は `gpt-5.6-luna` / `none`。
- ロールは保存済みIDを優先して解決し、必要なら作成して付与する。DB未初期化時にはカテゴリ名・チャンネル名による経路がある。既に保持しているロールは再付与しない。
- 新しいテキストチャンネルに案内を投稿する。
- `/vote` は2〜10候補、既定24時間、複数選択は既定有効。同じ候補の再クリックで取り消す。単一選択では既存票を取り消してから別候補へ投票する。終了時に票数を表示しボタンを無効化する。

根拠: `src/handlers/messageHandler.js`、`reactionHandler.js`、`channelCreateHandler.js`、`src/services/roleManager.js`、`recruitmentDetector.js`、`openaiService.js`、`src/commands/vote.js`。

## APP-03 ゲーム管理・復帰希望

- `/game-admin` と管理操作はサーバー管理権限を確認する。一般メンバーはゲーム希望、予定、募集、復帰希望を操作できる。
- 同じチャンネルの再登録は重複させず、同名の別チャンネルは自動統合しない。
- 人間の活動を確認でき、未活動期限を超えたゲームを休眠候補にする。Bot投稿だけで人間の活動日時を更新しない。スレッド投稿は親ゲームに帰属する。
- ソフトアーカイブはチャンネル・ロールを削除せず、設定・権限のスナップショットを保存し休止カテゴリへ移動する。途中失敗は復元を試み、中断状態はrepairの対象とする。再稼働では元設定を復元する。
- 「遊びたい」はページ単位で編集し、他ページや休止中ゲームの希望を保持する。公開パネルに希望者名を出さず、個人編集は本人だけへ表示する。
- 復帰希望は人数到達時に管理チャンネルへ通知する。自動再稼働はしない。同じアーカイブ周期で通知を重複作成せず、見送り後は再通知しない。再稼働時には通知を解決済みにする。

根拠: `src/interactions/gameAdminInteractionHandler.js`、`src/services/gameArchiveService.js`、`channelActivityService.js`、`gameReturnRequestService.js`、`gameMemberPanelService.js`、`src/repositories/gameInterestRepository.js`。

## APP-04 基本予定・月間予定・候補

- 一般ユーザー用パネルが入口。月曜〜日曜・日本の祝日の基本予定と、今月・翌月の週単位の月間予定を編集する。このチェックアウトにはDiscord Activityの月間カレンダーはない。
- 状態は未入力 → ○（参加可能）→ △（未定）→ ×（参加不可）→ 未入力。変更は即時保存する。
- 初期枠は平日21:00、土日祝14:00と21:00。基本予定から月間予定を補完するが既存の回答は上書きしない。明示的な未入力も保持する。確認後の「基本予定に戻す」は対象週を現在の基本予定に置き換える。
- 月・日時枠の所属ギルドと、操作対象の週・日・枠を検証する。本人IDはDiscord interactionから取得する。
- 集計対象は稼働中ゲームを「遊びたい」に登録した現メンバー。Bot・退会者を除外する。不完全なメンバーキャッシュは取得して補完し、取得失敗時には不完全な人数を返さない。
- 集計サービスはJSTの当日以降で○または△がある枠を日付・枠順で返す。○・△・×の人数を別々に表示する。
- **現行の二段階フィルタ**: パネルと募集サービスはさらに月のタイムゾーンで開始時刻が未来の枠に絞り、先頭10件を表示・募集対象とする。当日でも開始時刻を過ぎた枠は募集できない。集計サービスの「当日以降」と混同しない。

根拠: `src/services/scheduleService.js`、`schedulePanelService.js`、`gameCandidateService.js`、`src/repositories/availabilityRepository.js`、`src/interactions/scheduleMemberInteractionHandler.js`。

## APP-05 募集・参加・開催確定

- 有効な候補から一般メンバーが対応ゲームチャンネルへ募集できる。ゲーム・月・枠の所属、稼働状態、未来の先頭10候補、ロール・絵文字・送信先を再検証する。
- 同じゲームと枠の募集をDBの一意制約で防ぐ。pendingを確保し、送信と初期リアクション作成を行って利用可能にする。送信・初期化の失敗では予約解放と作成済みメッセージ削除を試みる。
- 👍／❌／一意なカスタム絵文字 `partyparrot` を付ける。参加／参加不可は後から追加した側を有効にし、追加・削除で一覧を更新する。同じメッセージのイベントを直列化する。
- 開催確定は👍で参加中の本人、Administrator、またはManageGuildとManageChannelsを両方持つメンバーが可能。絵文字は保存したIDで識別する。
- 確定は一度のみ。開催日の月タイムゾーンの12:00をリマインドへ直接登録し、メッセージ解析を通さない。確定絵文字を外しても取り消さない。確定後も参加一覧を更新できる。
- Discord投稿・SQLite・JSON保存を跨ぐ処理に完全な原子性はない。正常系・既知の失敗補償と二重処理抑止を仕様として守り、あらゆるクラッシュからの完全復旧を保証とは記載しない。

根拠: `src/services/gameRecruitmentService.js`、`src/repositories/gameRecruitmentRepository.js`、`src/migrations/005_game_recruitments.sql`。

## APP-06 リマインド・WebUI

- 返信で「リマインド」または `remind` を送ると、返信元の内容と送信日時から日付を抽出する。この経路の12:00はホストのローカル時刻であり、募集確定の明示的タイムゾーン変換とは異なる。
- リマインドはJSONへ保存し起動時に読み込む。過去時刻はスケジュールしない。通知成功後は待機リマインドを削除し、カレンダー予定は保持する。
- WebUIはCSVの読込・保存・再読込、判定ログ、カレンダー予定を提供する。`/api/health` はHTTP生存確認で、Discord接続や通知成功を保証しない。
- 現行WebUIにはアプリ側の認証・ギルド単位のアクセス分離がない。アクセス制御は運用環境側で行う前提とし、Discordの本人限定編集と同じ権限モデルだと解釈しない。

根拠: `src/services/reminderService.js`、`webServer.js`、`public/`。

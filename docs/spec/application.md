# アプリケーション仕様（正本）

2026-09-12、`16a2713` の実装を基準とし、以降の変更を反映する。関連判断: [ADR-0005](../adr/0005-main-activity-baseline.md)、[ADR-0007](../adr/0007-confirmed-calendar-activity.md)。

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
- 募集判定は `features.recruitmentDetection.provider` の `openai`（未指定時）または `jev` で切り替える。OpenAIのモデル・reasoningは設定可能で、既定値は `gpt-5.6-luna` / `none`。日付抽出はOpenAIを継続する。
- JevはTypeSafe HTTP APIのNoulを使い、確率が `jev.threshold`（既定0.8）以上なら募集。モデル既定は `jev-latest`、タイムアウト既定10秒。API応答の型と確率範囲を検証する。失敗時は通知せず運用ログだけに記録し、他providerへ自動切替しない。
- 検出CSVの列は維持し、OpenAIは理由を記録、Jevは理由を常に空文字にする。WebUIも空白表示。
- CSVは検索や再学習を行うRAGではなくfew-shotの判定例。最大32件、本文2000文字、理由500文字、本文と理由の合計16000文字。空本文、不正ラベル、NFKC・空白・大文字小文字正規化後の重複／矛盾を拒否する。理由は任意。
- 判定は参加の呼びかけの意図を優先し、否定・終了・引用のみ・参加表明を区別する。本文と参考例を指示から分離し、例への類似だけでラベルを固定しない。
- WebUI更新は検証・一時CSVの再読込を行ってから同一ディレクトリで置換し、実行中の判定例も反映する。不正入力は400、保存失敗は500。読込・保存失敗では直前の正常な例を維持する。初回読込失敗時は例なし、正常な空CSVは例をクリアする。
- Composeの標準CSVパスは初回に `data/recruitment_data.csv` へ移行し、以後はディレクトリマウント内で保存する。移行済みファイルは上書きしない。独自csvPathと通常起動は設定を優先する。
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
- Activityの候補詳細では回答者名を表示するため、ゲーム希望者が分かることを共通入口の案内に明示する。
- 復帰希望は人数到達時に管理チャンネルへ通知する。自動再稼働はしない。同じアーカイブ周期で通知を重複作成せず、見送り後は再通知しない。再稼働時には通知を解決済みにする。

根拠: `src/interactions/gameAdminInteractionHandler.js`、`src/services/gameArchiveService.js`、`channelActivityService.js`、`gameReturnRequestService.js`、`gameMemberPanelService.js`、`src/repositories/gameInterestRepository.js`。

## APP-04 基本予定・月間予定・候補

- 一般ユーザー用パネルの「予定・候補日を開く」が共通入口。同じActivity内で予定入力／候補日確認を切り替える。月曜〜日曜・日本の祝日の基本予定と、今月・翌月の月間予定を編集する。従来の週単位パネルは代替として維持する。
- 状態は○（参加可能）・△（未定）・×（参加不可）・未入力。Activityでは直接指定し即時保存する。従来パネルは未入力 → ○ → △ → × の循環操作。
- 予定枠は平日の夜、土日祝の昼／夜。固定開始時刻は表示・候補判定に使わず、既存の保存値は互換用として維持する。基本予定から月間予定を補完するが既存の回答は上書きしない。明示的な未入力も保持する。確認後の「基本予定に戻す」は対象週を現在の基本予定に置き換える。
- 月・日時枠の所属ギルドと、操作対象の週・日・枠を検証する。本人IDはDiscord interactionから取得する。
- 集計対象は稼働中ゲームを「遊びたい」に登録した現メンバー。Bot・退会者を除外する。不完全なメンバーキャッシュは取得して補完し、取得失敗時には不完全な人数を返さない。
- 集計サービスは月のタイムゾーンで今日以降の○または△がある枠を日付・枠順で返す。○・△・×の人数を別々に表示する。
- Activityでは月内の全候補を表示し、日付詳細には回答者の名前・回答・募集状態を表示する。未回答者は候補詳細に追加しない。従来パネルの表示は先頭10件だが、募集サービスに10件制限はない。今日の枠は保存開始時刻を過ぎても募集できる。

根拠: `src/services/scheduleService.js`、`schedulePanelService.js`、`gameCandidateService.js`、`src/repositories/availabilityRepository.js`、`src/interactions/scheduleMemberInteractionHandler.js`。

## APP-05 募集・参加・開催確定

- 有効な候補から一般メンバーが対応ゲームチャンネルへ募集できる。ゲーム・月・枠の所属、稼働状態、今日以降の有効候補、ロール・絵文字・送信先を再検証する。
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
- 既存のCSV・リマインドWebUIにはアプリ側の認証・ギルド単位のアクセス分離がない。アクセス制御は運用環境側で行う前提とし、認証付きActivity API（APP-07）と同じ権限モデルだと解釈しない。

根拠: `src/services/reminderService.js`、`webServer.js`、`public/`。

## APP-07 Activity認証・共有カレンダー

- 共通入口に「予定入力」「候補日確認」「確定済み予定」の3タブを持つ。確定済み予定はリマインドで保存した `calendarEvents` を読み、通知後も履歴を表示する。予定編集と候補からの募集投稿を同じActivityで行える。
- 確定済み予定は前月・翌月・今月へ移動でき、過去月も閲覧する。サーバーの予定タイムゾーンで日付を判定し、リマインド用の12:00をゲームの開始時刻として表示しない。月セルを選ぶと予定内容を日付詳細に表示する。
- 確定済み予定のAPIは `/api/activity/schedule/calendar`。認証元サーバーの、本人にチャンネル閲覧・履歴閲覧権限がある現在のチャンネルだけを対象にする。私有スレッドは参加済みまたはスレッド管理権限を要する。他サーバー・削除済みチャンネル・権限のない予定は返さない。チャンネルIDで絞り込み、選択したチャンネルのロールメンバーに関連する他チャンネルの予定と名前も表示する。ゲームでは保存済みロールID、ゲーム未登録では同名ロールを使う。
- `activity.enabled` と `webui.enabled`、Discord clientSecret、32文字以上のsessionSecretを設定して有効化する。Activityは `/schedule/`、APIは `/api/activity/schedule`。Viteでビルドする。
- Discord SDKのidentify認可コードをサーバーで交換し、OAuth本人、Activity instanceのアプリ・ギルド・参加者、現在の非Bot所属を照合する。URLや本文のguild/userを信用しない。
- HMAC署名の短期セッションを使用する（既定5分）。全認証済みAPIで署名・期限・現在の所属を検証する。トークンはクライアントのメモリで保持する。通常ブラウザ・ギルド情報のない起動では予定を取得しない。
- 全非Botメンバーの予定を共有し、日付詳細では名前と回答を表示する。編集・復元は認証本人のみで、管理者も他人を書き換えない。退会者は表示から外すが保存済みデータは残す。
- 日曜始まり7列の月間カレンダー。今月内の過去日も編集可能で、月外は編集しない。月セルの「未」は未入力と未登録の合計。未登録は対象月に回答も適用可能な基本予定もない状態で、詳細では未入力と区別する。
- 範囲復元は同一月内の両端を含む連続範囲をタップで指定し、プレビュー後に確認する。基本なしは明示未入力へ戻す。回答・基本予定のrevisionが変化した場合は409で拒否し、範囲全体をトランザクションで復元する。
- 表示中は5秒ごとの更新と手動更新。非表示・縮小時は定期更新を止め、縮小時の変更操作を防ぐ。月・ゲーム切替前の古い応答を適用しない。募集の通信結果不明時は自動再送せず再取得する。
- APIは本人・guildの上書き、不正ID・状態・対象月を拒否し、no-store、本文8KB制限、レート制限を適用する。内部エラーや秘密値を返さない。401の再認証は共有し、再認証後も401なら無限再試行しない。
- 候補詳細からの募集はAPP-05の既存サービスへ接続する。Activity内では参加表明・開催確定を行わず、Discord募集メッセージで操作する。
- Botのコマンド登録ではPortalの既存Entry Pointを保持する。取得失敗時は一括上書きを実行せず、存在しないEntry Pointを推測作成しない。

根拠: `src/routes/activityScheduleRouter.js`、`src/services/activityAuthService.js`、`activitySessionService.js`、`activityScheduleService.js`、`activityCandidateService.js`、`activityCalendarService.js`、`guildMemberService.js`、`src/bot.js`、`activity/src/`。

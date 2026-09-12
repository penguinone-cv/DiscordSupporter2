# テスト方針（正本）

関連判断: [ADR-0004](../adr/0004-risk-based-tests.md)。対応する振る舞いは [アプリケーション仕様](application.md) を参照する。

## 採否基準

テスト数や網羅率に目標を置かず、「壊れたときに利用者・データへ何が起きるか」で選ぶ。全変更でTDDを義務化しない。複雑なロジックや不具合再現では必要に応じて先にテストを書く。

- 残す: 権限・所属境界、破壊や誤通知の防止、日付境界、重要な状態遷移、保存制約、競合・失敗補償、具体的な回帰不具合。
- まとめる: 同じ業務フローで確認できる正常系と単純ヘルパー。意味の異なる境界ケースは、件数を減らすためだけに一つの巨大テストへまとめない。
- 削除する: 単なる内部フィールド代入、consoleへの転送や装飾、同じ契約の重複。削除理由と、代替テストまたは自動検証しない範囲をADRへ記録する。
- モックは通信・時刻・ファイル境界を中心に置く。モック自身の返値しか検証しないテストを避ける。Discord builderやCSV parserは可能なら実物を使う。
- UIテストは重要な導線、本人限定応答、Discordの件数・ID制約を守る。文言や色の全列挙はしない。単なる呼出し確認でも、ルーティング・副作用・誤通知を防ぐ境界なら残す。

## 残す検証の責務

パスは `tests/` 起点。`*.test.js` は自動テスト全体で、実SQLiteを使うサービス／repositoryテストは結合テストとして扱う。単体テスト削減のためにこれらを削除・改名しない。

| 仕様 | テストファイル（拡張子 `.test.js`） | 守る責務 |
| --- | --- | --- |
| APP-01 | `config/configLoader` | 必須設定・仮値の拒否、設定取得 |
| APP-01/03 | `repositories/gameRegistryRepository` | マイグレーション、登録一意性、休眠条件 |
| APP-02 | `utils/csvLoader`、`services/recruitmentDetector`、`services/openaiService` | CSV分類・読込失敗、判定失敗・ログのCSVエスケープ、外部リクエスト契約 |
| APP-02 | `handlers/messageHandler`、`handlers/reactionHandler`、`services/roleManager` | 対象外の除外、通知先、機能フラグ、リアクション配送、ロール付与 |
| APP-02 | `handlers/channelCreateHandler`、`handlers/interactionHandler`、`commands/vote` | イベント／コマンド入口、応答エラー処理、投票制約・集計 |
| APP-03 | `services/channelActivityService`、`services/archiveCategoryService`、`services/gameArchiveService` | Bot／人間活動、カテゴリ上限、復元・ロールバック |
| APP-03 | `repositories/gameInterestRepository`、`services/gameReturnRequestService` | 希望保持、ギルド境界、通知閾値・見送り・再同期 |
| APP-03 | `services/gameAdminPanelService`、`services/gameMemberPanelService`、`interactions/gameMemberInteractionHandler` | ページ保存、ID重複防止、非公開編集・復帰導線 |
| APP-04 | `services/scheduleService`、`services/gameCandidateService`、`utils/scheduleDate` | 基本予定の補完と保持、休日・月・タイムゾーン境界、メンバー集計 |
| APP-04/05 | `services/schedulePanelService`、`interactions/scheduleMemberInteractionHandler` | 候補表示・募集への導線、保留応答、エラー通知 |
| APP-05 | `repositories/gameRecruitmentRepository`、`services/gameRecruitmentService` | 一意制約・状態遷移、資格、失敗補償、リアクション競合・確定の冪等性 |
| APP-06 | `services/reminderService` | 日付抽出の失敗、保存・復元、予定保持 |

## 実行と限界

依存関係を `npm ci` で用意し、変更中は `npx vitest run <対象ファイル>`、完了時は `npm test` を実行する。ドキュメントのみの変更はリンク・実装との整合性確認でよく、機械的にテストを増やさない。実装を変更した場合は影響する重要なケースを選び、削除後もその保証が残るか確認する。

このテスト群は実Discord／OpenAIへの通信、WebUIの認証、デプロイ環境、全権限経路を網羅しない。管理操作の権限ゲートやWebUIは現状の自動テストに不足があり、「全テスト成功」を完全検証としない。該当機能を変更するときは次の実機確認と必要な自動回帰ケースを選ぶ。

- Discord: 一般メンバー／管理者の境界、本人だけの予定編集、候補→募集→別ユーザーの参加→確定→通知。
- アーカイブ: 権限とカテゴリの復元、途中失敗時の状態。
- WebUI: CSV保存後の判定データ反映、ログ・カレンダー表示。ヘルスチェックだけでBot稼働判定しない。
- ログ: 出力先とエラーが運用上確認できること。プレフィックス・日時表記・DEBUG切替に専用単体テストは置かない。

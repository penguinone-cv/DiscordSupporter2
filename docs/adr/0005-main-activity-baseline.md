# ADR-0005: 最新mainのActivity仕様へ基準を更新する

- 日付: 2026-09-12
- 状態: Accepted
- 置き換える判断: [ADR-0002](0002-application-boundaries.md)、[ADR-0003](0003-scheduling-and-recruitment.md)
- 継続する方針: [ADR-0001](0001-specifications-and-decision-log.md)、[ADR-0004](0004-risk-based-tests.md)
- 対応する正本: [APP-01〜07](../spec/application.md)、[テスト方針](../spec/testing.md)

## 背景

初回整理を `9af957f` としてコミットした後、利用者の依頼で最新main `16a2713` を取得してrebaseした。整理コミットは `fbc9c6a` となった。mainには固定開始時刻の廃止、Activity予定入力、同じActivity内の候補カレンダー・募集が追加されていた。旧正本の「Activityなし」「未来時刻の先頭10件のみ募集」は現行仕様ではなくなった。

## 判断

- 正本をmainの実装に合わせる。旧ADRの本文は経緯として保持し、状態と後継リンクだけ更新する。
- 予定は昼／夜枠で扱い、保存時刻は互換用とする。候補は月のタイムゾーンで今日以降。従来パネルの表示10件を維持しつつ、募集サービスは11件目以降も受け付ける。
- 共通Activity入口、全メンバーの共有予定、候補詳細の名前・回答、認証本人だけの編集、範囲revisionによる競合拒否を正本へ含める。認証付きActivityと既存WebUIの境界を明記する。
- main由来の13件の旧仕様書・手順・タスク・レビューを `docs/history/` へ移す。現行仕様の正本と区別し、過去の検証結果を今回の実機検証として扱わない。

## テストの再棚卸し

rebase直後は44ファイル・349ケースが成功した。初回の18ケース削減は維持できた。追加された認証、所属、範囲復元、二重募集防止、古い応答の破棄、Portal Entry Point保持のテストは、それぞれ異なる障害を検出するため残す。

`tests/activity/pageContract.test.js` の2ケースを削除する。HTMLの文言やCSSの `repeat(7, ...)`、`align-items: flex-end` の存在だけでは、実際の導線・モバイル表示が動くことは保証できない。代わりに正本の画面確認項目へ移す。日付グリッドのロジックは `calendarModel`、操作・縮小状態・応答競合は `scheduleApp` / `candidateApp` / `activityApp`、Web配信と本文制限は `activityWebServer` を維持する。実画面の配置をこれらで完全に検証したとはしない。

## 代替案

- 旧ADRを現行説明に書き換える: 旧基点の判断と再整理の経緯が消える。
- Activityテストを件数だけで大きく削減する: 認証・他人の編集防止・競合検出の保証を失う。
- 旧仕様書を現行の正本として併存させる: 古い入口名称や制約のどちらが有効か不明になる。

## 影響と検証

アプリ本体・DBは変更せず、正本と履歴を現行mainに整合させる。整理後は43ファイル・347ケースが全件成功した。`npm test -- --reporter=dot --silent`、`npm run build:activity`、差分・文書リンク確認で検証した。Discord実機・本番環境の確認は今回実施しない。

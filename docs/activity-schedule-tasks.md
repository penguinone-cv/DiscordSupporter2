# Discord Activity 月間予定カレンダー タスク分解

各実装タスクは `RED → GREEN → REFACTOR` の順で進める。テストを追加せずに実装だけを先行させない。

## Phase 0: ベースライン

- [x] T0-1 依存関係を準備し、既存の対象テストを実行する
- [x] T0-2 全テストのベースラインを記録する
- [x] T0-3 既存月間予定ハンドラーの不足テストを追加する

完了条件: Activity 追加前の既存挙動がテストで保護されている。

## Phase 1: 共有予定ドメイン

### T1-1 現在メンバー取得

- RED: 完全なメンバーキャッシュは fetch せず、不完全なら 1 回だけ fetch するテスト
- RED: fetch 失敗時に不完全な結果を返さないテスト
- GREEN: 既存候補日程処理から再利用可能なメンバー取得サービスを抽出
- REFACTOR: 同一ギルドの並行 fetch を共有する

### T1-2 月全体の回答取得

- RED: 月の全 slot と保存済み回答をユーザー別に取得するリポジトリテスト
- RED: `source = null`、`source = basic`、`source = manual`、明示的 `unset` を区別するテスト
- GREEN: 共有予定用クエリを追加
- REFACTOR: 既存候補日程クエリへ影響しないことを確認

### T1-3 共有カレンダー集計

- RED: 全非 Bot メンバーを母数に `○ + △ + × + 未 = 総数` となるテスト
- RED: 未入力と未登録、基本予定のみ、一部入力、退会者、Bot のテスト
- RED: 本人先頭・他メンバー表示名順のテスト
- GREEN: Activity 共有予定サービスを実装
- REFACTOR: 月・日・slotのレスポンス構造を固定

## Phase 2: 更新ドメイン

### T2-1 直接状態指定

- RED: 許可状態だけを冪等に保存するテスト
- RED: 別ギルド、別月、別日、別slot、他人の更新を拒否するテスト
- RED: 今月・翌月を許可し、前月以前を拒否するJST境界テスト
- GREEN: 直接状態指定サービスを実装
- REFACTOR: 従来の循環更新と共通検証を共有

### T2-2 範囲復元

- RED: 同月の連続範囲を両端込みで復元するテスト
- RED: 逆順、月外、月またぎ、前月、他人の範囲を拒否するテスト
- RED: 基本予定なしを未入力へ戻すテスト
- RED: stale revision を競合として拒否するテスト
- GREEN: サービス層の検証と既存 transaction 呼び出しを実装
- REFACTOR: 対象範囲の回答値、source、欠損、適用される基本予定を正規化した preview token の計算を共通化し、transaction 内で再検証する

## Phase 3: Activity 認証

### T3-1 セッショントークン

- RED: 正常署名、有効期限、改ざん、不正形式、秘密値不足のテスト
- GREEN: 短期 Activity セッションの発行・検証を実装
- REFACTOR: ログへトークンを出さないエラー型へ整理

### T3-2 OAuth と所属確認

- RED: Discord token exchange 成功・失敗のテスト
- RED: OAuth user と現在の guild member が一致するテスト
- RED: Activity インスタンスの application、guild、参加 user が一致しない場合の拒否テスト
- RED: 退会者、Bot、不明ギルドを拒否するテスト
- GREEN: Discord 側の Activity インスタンス検証を含む Activity 認証サービスを実装
- REFACTOR: Discord HTTP 呼び出しを注入可能にする

## Phase 4: Activity API

### T4-1 API 共通処理

- RED: JSON解析、Bearer認証、エラー形式、キャッシュ禁止、メソッド制限のテスト
- GREEN: Activity API router と middleware を実装

### T4-2 読み取り API

- RED: 今月・翌月の共有予定レスポンスと認可拒否テスト
- GREEN: 月間予定取得 route を実装

### T4-3 更新 API

- RED: 本人の slot 更新成功と他人・改ざん拒否テスト
- GREEN: slot 更新 route を実装

### T4-4 範囲復元 API

- RED: 確認済み revision の成功と 409 競合テスト
- GREEN: 範囲復元 route を実装

## Phase 5: Activity UI

### T5-1 純粋表示モデル

- RED: 日曜始まり6週グリッド、月外日、うるう年、JST today のテスト
- RED: slot集計表示、未の合算、詳細の未入力・未登録分離テスト
- GREEN: DOM非依存のカレンダー表示モデルを実装

### T5-2 Activity 初期化

- RED: Discord外、認証成功、認証失敗の状態遷移テスト
- GREEN: SDK ready/authorize/authenticate とAPI session取得を実装

### T5-3 カレンダーと詳細編集

- RED: 月切替、日付選択、本人だけの直接操作、保存状態のテスト
- GREEN: 7列カレンダー、日付詳細、直接更新を実装

### T5-4 範囲復元 UI

- RED: 開始・終了選択、確認、成功、競合、取消のテスト
- GREEN: 範囲選択と確認ダイアログを実装

### T5-5 共有更新とレイアウト

- RED: 自動更新、Focused復帰、PIP/Grid編集無効のテスト
- GREEN: 定期更新、手動更新、layout mode処理を実装
- REFACTOR: 更新中の選択状態と下部シートを維持する

### T5-6 レスポンシブとアクセシビリティ

- RED: 必須ARIA属性と編集不可状態のDOMテスト
- GREEN: desktop/mobile CSS、Safe Area、44px操作領域、live regionを実装

## Phase 6: Discord 導線

### T6-1 Activity 起動

- RED: Activity 有効時の起動応答と無効時のフォールバックテスト
- GREEN: メンバーパネルの起動ボタンと interaction handler を実装

### T6-2 表示文言

- RED: 全員閲覧・本人のみ編集の案内文テスト
- GREEN: パネル、README、設定例を更新

## Phase 7: 検証とレビュー

- [x] T7-1 変更単位の対象テストを実行
- [x] T7-2 全テストを実行
- [x] T7-3 `git diff --check` と全変更 JavaScript の `node --check`
- [x] T7-4 秘密値、認可漏れ、IDOR、XSS、キャッシュ、ログをレビュー
- [ ] T7-5 390px、768px、desktopで表示確認
- [x] T7-6 仕様書の受け入れ条件を1件ずつ照合
- [x] T7-7 未実施のDeveloper Portal・本番作業を明記

T1〜T6の実装・自動テストは完了。T7-5の実表示とDiscord実機確認は未実施で、ローカルDOM/CSS検証のみ。最終テスト306件成功。詳細と配備前の残事項は `activity-schedule-review.md` を参照。

## 依存関係

```text
T0
 ├─ T1 ─ T2 ─ T4
 ├─ T3 ───────┘
 └──────── T5 ─ T6 ─ T7
```

- T4 は T1、T2、T3 完了後に実施する。
- T5 の純粋表示モデルは T1 と並行して設計できるが、API 結合は T4 完了後に行う。
- T6 の本実装は Activity 初期化方式が確定した後に行う。

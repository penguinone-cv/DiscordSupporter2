# 固定開始時刻の表示・判定廃止 実装・検証手順書

## 1. 前提

- 確定仕様: `docs/specifications/remove-fixed-schedule-times.md`
- Node.js: `package.json` の指定どおり24系
- テスト: Vitest
- DBマイグレーションと外部ライブラリ追加は行わない

## 2. 事前確認

1. `git status --short` で既存変更を確認し、対象外の変更へ触れない。
2. `node --version` と `npm --version` を確認する。
3. `node_modules` がなければ `npm ci` でロックファイルどおりに依存関係を準備する。
4. 可能なら変更前の対象テストを実行し、ベースラインを記録する。

## 3. TDD: Red

### 3.1 予定・候補画面

`tests/services/schedulePanelService.test.js` に次のテストを先に追加する。

- 基本予定と月間予定詳細に `14:00` / `21:00` が出ない。
- 同日昼夜の候補が、日付＋`昼/夜` で区別できる。
- 候補本文とセレクトラベルに固定時刻が出ない。
- 対象タイムゾーンの当日を時刻に関係なく含め、前日を除外する。

対象テストを実行し、未実装のため期待どおり失敗することを確認する。

```powershell
npm test -- tests/services/schedulePanelService.test.js
```

### 3.2 募集メッセージ・募集可否・リマインド本文

`tests/services/gameRecruitmentService.test.js` に次のテストを先に追加する。

- 募集Embedが開催日＋`昼/夜`を表示し、固定時刻とDiscord日時timestampを含まない。
- 固定時刻を過ぎた当日候補でも募集でき、前日候補は拒否する。
- リアクション更新後のEmbedにも同じ表示を適用する。
- リマインド本文に固定時刻を含めず、通知日時は開催日12:00のままにする。

対象テストを実行し、未実装のため期待どおり失敗することを確認する。

```powershell
npm test -- tests/services/gameRecruitmentService.test.js
```

### 3.3 候補集計のタイムゾーン境界

`tests/services/gameCandidateService.test.js` に、JST以外の月間予定でもその月のタイムゾーンにおける今日を含み、前日を除外するテストを先に追加する。

```powershell
npm test -- tests/services/gameCandidateService.test.js
```

## 4. TDD: Green

1. `src/services/schedulePanelService.js` を最小限変更する。
   - 予定表示から `formatMinutes()` を除く。
   - 候補表示には時刻の代わりに `candidate.label` を含める。
   - 候補判定を月間予定のタイムゾーンにおける日付比較へ変更する。
2. `src/services/gameRecruitmentService.js` を最小限変更する。
   - 募集Embedを開催日＋区分表示へ変更する。
   - 募集可否と上位10件抽出を日付比較へ変更する。
   - `slotSummary()` から固定時刻を除く。
   - `dateAtMinutesInTimeZone()` は12:00リマインド生成にだけ残す。
3. `src/services/gameCandidateService.js` の日付境界を、JST固定ではなく月間予定のタイムゾーンへ合わせる。
4. 対象テストを再実行して成功させる。

```powershell
npm test -- tests/services/schedulePanelService.test.js tests/services/gameRecruitmentService.test.js tests/services/gameCandidateService.test.js
```

## 5. Refactor・文言整理

1. 日付単位の候補判定を重複させず、意図が分かる小さな関数へまとめる。
2. `候補日時`、`時間枠` などを、確定仕様に沿って `候補日程`、`予定枠` などへ必要最小限で整理する。
3. `README.md` の固定時刻説明を、平日夜・土日祝昼夜の区分説明へ更新する。
4. 未使用importを削除し、既存のコードスタイルに合わせる。

## 6. 実行結果の検証

1. 対象テストを再実行する。
2. 全テストを実行する。
3. 変更したJavaScriptファイルを構文検査する。
4. `rg` で対象UI・募集コード・READMEに固定時刻表示が残っていないことを確認する。
5. テスト数、成功・失敗、構文検査、残存検索結果を実行結果レビューへ記録する。

```powershell
npm test
node --check src/services/schedulePanelService.js
node --check src/services/gameRecruitmentService.js
node --check src/services/gameCandidateService.js
rg -n "14:00|21:00|formatMinutes|開催日時" src/services/schedulePanelService.js src/services/gameRecruitmentService.js README.md
```

## 7. 全体レビュー

次の観点で差分全体を確認する。

- 正確性: 固定時刻が表示・候補判定・募集判定に使われていないか。
- 一貫性: 予定画面、候補画面、募集初回投稿、更新投稿、リマインド本文が同じ日付＋区分表現か。
- 回帰: 日付順、昼夜順、上位10件、重複防止、リアクション、確定権限、12:00通知が維持されているか。
- 堅牢性: タイムゾーン境界と昨日以前の拒否がテストされているか。
- 互換性: DBスキーマと既存保存データを変更していないか。
- 環境適合性: Node.js 24 / Ubuntu 22.04でOS依存コードを増やしていないか。

レビューで不足が見つかった場合は、該当する前段階へ戻って修正・再検証する。

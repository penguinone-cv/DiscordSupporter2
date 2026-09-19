# Architecture Decision Log

ADR本文の保存場所。現在の仕様は [../spec/](../README.md) を参照する。番号は再利用しない。

| ID | 判断 | 状態 | 日付 |
| --- | --- | --- | --- |
| [0001](0001-specifications-and-decision-log.md) | 仕様の正本と設計判断履歴を分離する | Accepted | 2026-09-12 |
| [0002](0002-application-boundaries.md) | 現行アプリケーション境界と保存方式を基準化する | Superseded by 0005 | 2026-09-12 |
| [0003](0003-scheduling-and-recruitment.md) | 現行の予定・募集契約を基準化する | Superseded by 0005 | 2026-09-12 |
| [0004](0004-risk-based-tests.md) | リスクに応じて必要なテストを残す | Accepted | 2026-09-12 |

| [0005](0005-main-activity-baseline.md) | 最新mainのActivity仕様へ基準を更新する | Accepted | 2026-09-12 |

「現状の記録」は過去の採用日や理由を推測したものではない。初回整理時に確認した実装を今後の変更の基準として扱う。課題のある現状を記録しても、改善不能という意味にはしない。

## 新規ADRの形式

`NNNN-short-title.md` を作成し、次を記載する。テンプレート専用のテストは不要。

```markdown
# ADR-NNNN: 判断のタイトル

- 日付: YYYY-MM-DD
- 状態: Proposed / Accepted / Deprecated / Superseded by ADR-NNNN
- 対応する正本: ../spec/xxx.md の項目ID

## 背景
解決する問題、確認済みの制約。

## 判断
採用する選択と適用範囲。

## 代替案
検討した選択肢と採用しなかった理由。

## 影響
得られる効果、不利益、残る制限、必要な検証。
```

Accepted後の判断変更は新しいADRで行い、旧記録は状態と後継リンクを更新する。誤字・リンク修正は可能。ADRに日々の作業ログや大量のテスト出力を貼り付けない。

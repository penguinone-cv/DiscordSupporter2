# 募集判定の比較評価

判定例CSVはfew-shot用です。モデルの再学習やベクトル検索は行いません。`cases.json` は別の合成評価データで、実際のDiscord投稿は含みません。開発用dev 12件と確認用test 12件を用意しています。少数のスモーク評価であり、本番精度の保証や統計的な優劣の証明には使えません。

## 実行

- `npm run eval:recruitment`: データ検証のみ。APIを呼びません。
- `npm run eval:recruitment -- --live`: devで両providerを比較。
- `npm run eval:recruitment -- --live --test`: 調整後に固定したtestで両providerを比較。

実API評価は課金が発生します。ローカルconfig.jsonのopenai/jev設定、または `OPENAI_API_KEY` / `TYPESAFE_API_KEY` を用意します。評価スクリプトでは環境変数を優先します。しきい値を評価時だけ変更するには `--threshold 0.8` を追加します。既定値は0.8ですが、configに明示した値を優先します。別の設定ファイルを使う場合は `--config /path/to/config.json` を追加します（設定ファイルを書き換えたりコピーしたりしません）。相対csvPathはこの評価スクリプトのリポジトリルート基準です。Discordへのログイン・投稿や検出CSVの追記はしません。1回の評価は各providerに12リクエストです。

出力はデータのハッシュ、モデル、しきい値、ケースIDごとの正誤・Jev確率、TP/FP/TN/FN、エラー数、適合率・再現率、成功時の平均応答時間です。エラーを正解の非募集に数えず、エラーがあれば終了コード1にします。定義できない比率はnullです。モデルを変更・エイリアスを更新したら再評価してください。

## 改善の進め方

1. 本番の誤通知・見逃しを人が確認し、ラベルと投稿時の意味を整理する。検出ログの判定を自動で正解にしない。
2. 同じ会話・元文から派生した言い換えを同じ分割へまとめる。判定例、dev、test間で混ぜない。スクリプトは正規化した完全一致を検出するが、意味の類似は人が確認する。
3. devで基準・例・しきい値を調整する。通知用途のためFPを重視しつつ、再現率も比較する。testの結果を見ながら繰り返し調整しない。
4. 固定testで確認する。dev/testの重大な誤通知、APIエラーが残る場合は原因を調べてから運用でJevを選択する。
5. 本番の人手ラベル付きデータを蓄積し、実際の分布で再評価する。件数が増えたら代表例を選別する。検索を導入する場合も、評価による改善を確認してから採用する。

参考: [TypeSafe Noul](https://docs.typesafe.ai/primitives/noul)、[OpenAI few-shot](https://developers.openai.com/api/docs/guides/prompt-engineering#few-shot-learning)、[評価設計](https://developers.openai.com/api/docs/guides/evaluation-best-practices)。

初回の実API結果: [2026-09-19の比較評価](results-2026-09-19.md)。

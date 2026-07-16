
## 2026-07-15 設計見直しセッション
- **AIバックエンドをGemini Flashに移行**: 無料枠目的。モデルはgemini-2.5-flash（安定版・無料枠あり）をデフォルトにし、GEMINI_MODEL環境変数で差し替え可能にした。gemini-3-flash-previewはpreview版のため既定にしなかった。
- **モノリス分割**: index.html 1963行→300行、js/10モジュール＋css分離。Sonnet級モデルでも保守できる粒度が目的。ARCHITECTURE.md/CLAUDE.mdに不変条件を明文化。
- **夜景モードは切替式**: 見た目の好みが分かれるため既定は従来のまま、ヘッダー🌙ボタンで切替（localStorage永続）。タイル非表示＋CSS drop-shadowグロー方式で追加負荷ほぼゼロ。

## 2026-07-16 AI講評の一括リクエスト化
- のちさん提案により、全体講評+全藩コメントをJSON応答の1リクエストに統合（ace9b57）。無料枠RPM問題が根本解決、表示も数秒に。responseMimeType=application/json + maxOutputTokens 8192。

## 2026-07-16 PDFレイアウト刷新
- P1=総評+地図+凡例（地図下・大きめ）、P2以降=藩カード+行政コスト比較。ブロック実測で改ページ（見切れ根絶）
- タイポ統一ルール: 最小16pt（22px≒16.5pt）・行間160%・斜体禁止・Yu Gothic/Hiragino/Meiryoスタック

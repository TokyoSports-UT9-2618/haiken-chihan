# CLAUDE.md — 廃県置藩シミュレーター

47都道府県の市区町村を「藩」に再編するブラウザゲーム。**ビルドなしの静的サイト**。
詳細な設計・データ形式は `ARCHITECTURE.md` を必ず先に読むこと。

## ファイルマップ

- `index.html` — ゲーム本体（HTML のみ。JS は js/、CSS は css/style.css）
- `landing.html` — LP（CSS はインライン、JS は js/landing.js）
- `js/` — ES Modules。config / geo / cost / state / map / ai / ui / game / pdf / main / landing
- `css/style.css` — index 用スタイル
- `data/` — 県・市区町村データ（scripts/ で生成。手編集しない）
- `functions/api/ai.js` — Cloudflare Pages Functions（Gemini APIプロキシ）
- `scripts/` — データ生成用 Node スクリプト（ゲーム実行には不要）
- `old/` — 旧ファイル置き場（参照しない）

## ルール

1. **ビルドツール・フレームワーク・npm依存を導入しない**。Vanilla JS (ESM) + CDN（Leaflet / jsPDF / html2canvas）のみ。
2. **モノリスに戻さない**。JS を HTML にインラインで書かない。新機能は js/ の該当モジュールへ。
3. inline `onclick=` 属性は禁止（ESMでは動かない）。id + addEventListener か、data-action + イベント委譲。
4. 循環importを作らない。map ↔ game 間はコールバック注入（`setMuniClickHandler`）で切ってある。
5. コード本体は英語、コメント・ドキュメント・コミットメッセージは日本語OK。
6. 目標人口 40万人/藩などのゲームバランス定数は `js/config.js` に置き、勝手に変えない。
7. セーブ形式を変えるときは `js/state.js` の `SCHEMA_VERSION` を上げる。

## ローカル実行

```bash
python3 -m http.server 8765
# http://localhost:8765/landing.html （LP）
# http://localhost:8765/index.html?prefs=07 （福島単県で直接起動）
```

## デプロイ

Cloudflare Pages。GitHub の main に push すると自動デプロイ（手動デプロイ不要）。
AI講評には Pages 環境変数 `GEMINI_API_KEY` が必要（ローカルでは /api/ai は動かない）。

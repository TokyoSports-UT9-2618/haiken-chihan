# ARCHITECTURE — 廃県置藩シミュレーター

47都道府県の市区町村を「藩」（＝スマートシュリンクシティ）にグループ化するブラウザゲーム。
ビルドツールなし・フレームワークなしの静的サイト。Vanilla JS（ES Modules）+ Leaflet(CDN)。

## ページ構成

| ファイル | 役割 |
|---|---|
| `index.html` + `js/landing.js` | トップページ。日本地図SVGで都道府県を選ぶ → `game.html?prefs=04,07,...` へ遷移 |
| `game.html` + `js/main.js` | ゲーム本体。市町村を藩に割り当てる |
| `css/style.css` | game.html のスタイル（トップページの CSS はインラインのまま） |
| `functions/api/ai.js` | Cloudflare Pages Functions。Gemini API プロキシ（要 `GEMINI_API_KEY` 環境変数、GEMINI_SETUP.md参照） |

## JS モジュール構成（js/）

依存は一方向。循環importなし（下ほど上位）。

| モジュール | 内容 | 依存 |
|---|---|---|
| `config.js` | TARGET_POP(40万)・TARGET_RANGE・CONFIG・HAN_COLORS(12色) | なし |
| `geo.js` | `isConnected(codes, getNeighbors)` — BFS連結判定（index/landing共通） | なし |
| `cost.js` | 行政コスト計算の純粋関数群（SALARY_TIERS, calcMunicipalityCost, calcHanCost, calcAfterCost, formatOku） | なし |
| `state.js` | ゲーム状態 `state`・ロード済みデータ（MUNICIPALITIES/ADJACENCY/BEFORE_COST）・Undo履歴・localStorage セーブ/ロード・隣接クエリ・スコア計算 | geo |
| `map.js` | Leaflet初期化（GSIタイル）・GeoJSON描画・スタイル更新・jumpToMuni。クリック処理は `setMuniClickHandler` で main から注入 | config, state |
| `ai.js` | `/api/ai` 呼び出し・プロンプトテンプレート・クリア後AIコメント | state |
| `ui.js` | サイドパネル・各モーダル・トースト・コスト比較表示 | config, state, cost, map, ai |
| `game.js` | 藩の作成/確定/解散・特区・Undo・リセット | config, state, map, ui |
| `pdf.js` | PDFレポート生成（jsPDF+html2canvas はCDNグローバル）。PDF用の簡易地図レンダラー `renderMapCanvas` 内蔵 | config, state, cost, map, ui |
| `main.js` | エントリーポイント。イベント配線（addEventListener / 委譲）と `initGame`（データ読み込み） | 全部 |
| `landing.js` | LPロジック（PRESETS・県選択・隣接自動参戦） | config, geo |

### イベント配線の方針
- HTML に inline `onclick=` は使わない（ESM ではグローバル関数が見えないため）。
- 静的ボタンは id を付けて main.js で `addEventListener`。
- innerHTML で再生成されるボタン（藩カード・未割り当てリスト等）は `data-action` 属性 + 親要素へのイベント委譲。

## データフロー

1. LP: `data/prefectures.json`（隣接情報 `adjacent[]` はハードコード済み）+ `data/japan-prefectures.svg`（Geolonia）を読み、選択県+隣接県のコードを `?prefs=` で渡す
2. ゲーム: `?prefs=` を解析 → 県ごとに `data/{pref}/municipalities.json` と `adjacency.json`、県ペアごとに `data/cross/{a}_{b}.json` を並列fetch → MUNICIPALITIES/ADJACENCY 構築
3. 地図: `prefectures.json` の `geojsonUrl`（`data/{pref}/boundaries.geojson`、smartnews-smri/japan-topography 由来）を fetch して Leaflet 描画
4. クリア時: `/api/ai` で講評取得（非同期）、PDF は DOM 上の AI テキストを取り込んで生成

## データファイル形式（data/）

- `prefectures.json` — 全47県メタ。`{ code, name, mapCenter, mapZoom, targetPop, geojsonUrl, municipalityCount, totalPopulation, adjacent[], prefCost{governorAnnual, assemblyCount, assemblyAnnualPerPerson, facilityAnnual} }`
- `{pref}/municipalities.json` — `[{ code(5桁), prefCode, name, pop(2020国勢調査), taxRevenue(円・2018年度), lat, lng }]`
- `{pref}/adjacency.json` — 県内隣接ペア `["07201_07210", ...]`
- `cross/{a}_{b}.json` — 県境をまたぐ隣接ペア（同形式・空配列あり）
- `{pref}/boundaries.geojson` — 市区町村ポリゴン（simplify済み）
- `japan-prefectures.svg` — LP用日本地図（`g[data-code]`、コードはゼロパディングなし "1"〜"47"）

## セーブデータ（localStorage）

- キー: `haiken_saves`（スロット1-4）/ `haiken_autosave`（自動保存）
- `state.js` の `SCHEMA_VERSION`（現在 3）と `schemaVersion`（旧データは `version`）が一致しないデータは読み込み時に破棄される

## ローカル実行 / デプロイ

```bash
python3 -m http.server 8765   # → http://localhost:8765/
```
※ AI講評（/api/ai）はローカルサーバーでは動かない（Pages Functions のため）。

デプロイ: Cloudflare Pages（ビルドなし）。GitHub `TokyoSports-UT9-2618/haiken-chihan` の main に `git push` すると自動デプロイ。
本番: https://haiken-chihan.pages.dev/ ／ AI機能には Pages の環境変数 `GEMINI_API_KEY` が必要（GEMINI_SETUP.md参照）。

## 不変条件（変えないこと）

- **目標人口 40万人/藩**（30〜50万が適正レンジ）— 廃県置藩の思想における「商圏エコシステムが回る最小ライン」。`config.js` の TARGET_POP。
- 飛び地禁止 — 藩は隣接市町村のみで構成（`geo.isConnected` による連結保証）
- Leaflet の `fillRule: 'nonzero'`（ポリゴン虫食い対策）
- ビルドツール・フレームワークを導入しない（CDN + Vanilla ESM のみ）
- コスト数値は概算・推計値であり政策判断用ではない（免責表示を消さない）

## 今後の課題（Future Work）

- **Phase D**: ゲーム中の範囲拡張（「＋ 範囲を広げる」ボタンで隣接県を追加読み込み）
- **URLシェアセーブ**: セーブデータをURL化して共有（現状は localStorage のみ）
- ~~`/` → LPリダイレクト~~ → 済（index.html自体をトップページ化。注意: Pagesは/index.htmlを/に正規化するため`_redirects`の`/`ルールは書かないこと）
- Cloudflare Pages 環境変数 `GEMINI_API_KEY` の設定（未設定だとAI講評・PDFのAI文が動かない）

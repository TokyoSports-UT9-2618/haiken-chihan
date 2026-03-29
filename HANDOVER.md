# 廃県置藩シミュレーター — ハンドオーバー

**作成日**: 2026-03-29
**前回**: 2026-03-22
**ステータス**: Phase C（LP）実装済み、Phase D（範囲拡張）未着手

---

## プロジェクト概要

- **ゲーム内容**: 都道府県の市区町村を「藩＝スマートシュリンクシティ」にグループ化するブラウザゲーム
- **目標人口**: 1藩あたり30〜50万人
- **本番URL**: https://haiken-chihan.pages.dev/
- **ランディングページ**: https://haiken-chihan.pages.dev/landing.html
- **GitHub**: https://github.com/TokyoSports-UT9-2618/haiken-chihan
- **ローカル確認**: `python3 -m http.server 8765`

---

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | index.html / landing.html（Leaflet.js CDN、vanilla JS） |
| ホスティング | Cloudflare Pages（GitHub main pushで自動デプロイ） |
| AI API プロキシ | Cloudflare Pages Functions（`functions/api/ai.js`） |
| GeoJSONソース | smartnews-smri/japan-topography（国土数値情報ベース） |
| 旧ホスティング | Netlify（移行済み、未削除） |

---

## ディレクトリ構成

```
/
├── index.html                  # ゲーム本体（全機能含む）
├── landing.html                # ランディングページ（都道府県選択UI、スチームパンク風）
├── wrangler.toml               # Cloudflare設定
├── .env.local                  # e-Stat APIキー（gitignore済み）
├── functions/
│   ├── api/ai.js               # AI講評プロキシ（Claude Haiku）
│   └── geo/[[path]].js         # R2プロキシ（現在未使用）
├── data/
│   ├── prefectures.json        # 47都道府県メタ情報（adjacent[]フィールド含む）
│   ├── japan-prefectures.svg   # 都道府県選択用SVG（Geolonia提供）
│   ├── 01〜47/
│   │   ├── municipalities.json # 市区町村リスト（コード/名前/人口/税収/緯度経度）
│   │   ├── adjacency.json      # 県内隣接ペア（turf.booleanIntersectsで生成）
│   │   └── boundaries.geojson  # 市区町村ポリゴン（smartnews-smriから取得）
│   └── cross/
│       └── XX_YY.json          # 県境隣接ペア（120ファイル）
└── scripts/
    ├── generate-pref-data.js   # 都道府県データ生成（e-Stat GIS、旧方式）
    ├── generate-all.js         # 全47県を順次生成（旧方式）
    ├── download-smri-geojson.js # ★ smartnews-smriからGeoJSON取得（推奨）
    ├── rebuild-adjacency.js    # ★ boundaries.geojsonから隣接データ再生成
    ├── fix-gaps.js             # ポリゴン虫食い修正（旧方式、今は不要）
    ├── fetch-tax.js            # ★ e-Stat APIから税収データ取得
    ├── split-seirei-tax.js     # ★ 政令指定都市の区に税収を人口按分
    ├── generate-cross-adj.js   # 県境隣接リスト生成
    ├── strip-holes.js          # 内部リング除去（旧方式）
    └── verify.js               # データ検証
```

---

## 2026-03-29 の作業内容

### 解決した問題

| # | 内容 | コミット |
|---|---|---|
| 1 | **ポリゴン虫食い根本解決**: smartnews-smri/japan-topographyのGeoJSONに差し替え | 2fc0fa9 |
| 2 | **隣接データ修復**: 宮城・福島が0ペアだった問題を修正、全県再生成 | 6ffd5a1 |
| 3 | **税収データ取得**: e-Stat APIから全1896市区町村の税収を取得 | 8ad8bcd |
| 4 | **ヘッダー動的化**: 県名・市町村数を選択県に応じて動的更新（6箇所） | 8b6c536 |
| 5 | **LP実装（Phase C）**: スチームパンク風ランディングページ | c93c63d |
| 6 | **隣接県自動参戦**: LP選択県の隣接県がゲームに自動含まれる | b7c5800 |
| 7 | **藩色コントラスト改善**: 確定藩を濃く、未割当を薄くして区別しやすく | 59a19b2 |

### GeoJSONデータソース変更（重要）

**旧方式（廃止）**: e-Stat GIS小地域 → turf.union → simplify → バッファ修正
- 虫食い・隙間が多発、修正に手間がかかる

**新方式（現行）**: smartnews-smri/japan-topography から直接取得
- `node scripts/download-smri-geojson.js --all` で全県取得
- simplify済み・虫食いなし・軽量（全県合計6.5MB）
- ソース: https://github.com/smartnews-smri/japan-topography
- ライセンス: 国土数値情報利用規約（出典表記必要）

### 税収データ

- e-Stat API statsDataId=0003173281（2018年度地方税）
- 全1896/1896市区町村に税収データあり
- 政令指定都市の区は市全体を人口按分
- `.env.local` に `ESTAT_APPID` が必要（gitignore済み）

---

## 現在の状態

### 完成している機能
- 全47都道府県・1896市区町村のゲームロジック
- ランディングページ（都道府県選択→ゲーム遷移）
- 選択県の隣接県が自動でゲームに含まれる
- GeoJSONポリゴン（smartnews-smri、虫食いなし）
- 県内隣接データ（turf.booleanIntersectsで生成）
- 県境隣接データ（data/cross/、120ファイル）
- 税収データ（全1896市区町村）
- スコア計算・コスト試算・税収表示
- AI講評（Cloudflare Functions経由、Claude Haiku）※API KEY要確認
- PDFレポート生成
- 遊び方モーダル
- ヘッダー・モーダル・コスト・PDFの県名/市町村数が動的

### ランディングページ（landing.html）
- スチームパンク風デザイン（真鍮・銅・鉄のテクスチャ）
- 日本地図SVG（Geolonia）で都道府県クリック選択
- 3段階表示: 選択中(金) → 自動参戦(銅) → 追加可能(緑)
- 飛び地防止の連結性チェック
- プリセット（東北6県、南関東4県、近畿5県 等8種）
- 戦況パネル（市区町村数・総人口・推奨藩数）
- 「出陣せよ」ボタンで `index.html?prefs=...` に遷移
- レスポンシブ対応（スマホ: 出陣ボタンsticky）
- 都道府県隣接データは prefectures.json の adjacent[] にハードコード

---

## 残っている問題・積み残し

### 優先度: 高

#### 1. ANTHROPIC_API_KEY の設定確認
AI講評・PDFレポートが動かない。Cloudflare Pagesの環境変数に設定が必要。
- Dashboard → Pages → haiken-chihan → Settings → Environment variables
- `ANTHROPIC_API_KEY` を設定

### 優先度: 中

#### 2. Phase D: ゲーム中の範囲拡張
ゲームプレイ中に「＋ 範囲を広げる」ボタンで隣接県を追加する機能。
design.md のセクション5-3に設計あり。

#### 3. セーブ/ロード改善
- 現在はlocalStorageの3スロットのみ
- ブラウザを変えると消える
- URLシェアやサーバーサイド保存の要望あり（ユーザーからの明確な要望）

#### 4. index.htmlのデフォルトURLをlanding.htmlに変更
現在 `/` にアクセスすると index.html（福島デフォルト）が開く。
landing.html をデフォルトにするリダイレクト or 統合が必要。

### 優先度: 低

#### 5. Netlify削除
Cloudflare移行後も旧Netlifyサイトが残っている。

#### 6. LP外観の追加調整
- スチームパンクテーマの細部磨き込み（ユーザーは方向性を気に入っている）
- 地図のホバーエフェクト強化
- 蒸気パーティクルアニメーション（CSSは定義済み、未使用）

---

## スクリプト使い方（現行版）

```bash
# GeoJSONを取得（smartnews-smriから）
node scripts/download-smri-geojson.js --all

# 隣接データを再生成
node scripts/rebuild-adjacency.js --all

# 税収データを取得（.env.localにESTAT_APPIDが必要）
node scripts/fetch-tax.js --all
node scripts/split-seirei-tax.js

# 県境隣接データの再生成
node scripts/generate-cross-adj.js
```

---

## 技術メモ

- **GeoJSONソース**: smartnews-smri/japan-topography（N03-21、2021年データ）
- **色割り当て**: `state.hanCounter % HAN_COLORS.length`（12色ローテ）
- **藩の色**: fillOpacity 0.70（濃め）、未割当は 0.20（薄め）
- **HAN_COLORS**: 12色、彩度高めのパレット
- **Leaflet fillRule**: `'nonzero'` で自己交差ポリゴン対策
- **都道府県隣接**: prefectures.json の adjacent[] にハードコード（cross/ファイルからの自動生成は不正確だったため）
- **e-Stat API (税収)**: statsDataId=0003173281、2018年度、政令指定都市の区は人口按分
- **e-Stat API (人口)**: statsDataId=0003433219、2020年国勢調査
- **LP SVG**: Geolonia提供、data-code属性でゼロパディングなし（"1"〜"47"）

---

## 参考資料

- `design.md` — UI/UX設計書（Phase A〜E のロードマップ含む）
- `haiken-chihan-spec.md` — 元の仕様書
- smartnews-smri/japan-topography: https://github.com/smartnews-smri/japan-topography
- Geolonia SVG: https://github.com/geolonia/japanese-prefectures
- e-Stat API: statsDataId=0003433219（人口）、0003173281（税収）

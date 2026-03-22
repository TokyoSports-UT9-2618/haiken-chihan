# 廃県置藩シミュレーター — ハンドオーバー

**作成日**: 2026-03-22
**ステータス**: ポリゴン表示バグ修正中、Phase C（ランディングページ）未着手

---

## プロジェクト概要

- **ゲーム内容**: 都道府県の市区町村を「藩＝スマートシュリンクシティ」にグループ化するブラウザゲーム
- **目標人口**: 1藩あたり30〜50万人
- **本番URL**: https://haiken-chihan.pages.dev/
- **GitHub**: https://github.com/TokyoSports-UT9-2618/haiken-chihan
- **ローカル確認**: `python3 -m http.server 8765`

---

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | index.html 単一ファイル（Leaflet.js CDN、vanilla JS） |
| ホスティング | Cloudflare Pages |
| AI API プロキシ | Cloudflare Pages Functions（`functions/api/ai.js`） |
| GeoJSON配信 | Pages CDN（`data/XX/boundaries.geojson` を静的配信） |
| 旧ホスティング | Netlify（移行済み、まだ削除していない） |

---

## ディレクトリ構成

```
/
├── index.html                  # メインゲームファイル（全機能含む）
├── wrangler.toml               # Cloudflare設定
├── functions/
│   ├── api/ai.js               # AI講評プロキシ（Claude Haiku）
│   └── geo/[[path]].js         # R2プロキシ（現在未使用）
├── data/
│   ├── prefectures.json        # 47都道府県メタ情報
│   ├── _japan_cache.geojson    # dataofjapan DLキャッシュ（gitignore推奨）
│   ├── 01〜47/
│   │   ├── municipalities.json # 市区町村リスト（コード/名前/人口/緯度経度）
│   │   ├── adjacency.json      # 県内隣接ペア
│   │   └── boundaries.geojson  # 市区町村ポリゴン（Leaflet表示用）
│   └── cross/
│       └── XX_YY.json          # 県境隣接ペア（120ファイル）
└── scripts/
    ├── generate-pref-data.js   # 都道府県データ生成（e-Stat GIS）
    ├── generate-all.js         # 全47県を順次生成
    ├── generate-cross-adj.js   # 県境隣接リスト生成
    ├── download-boundaries.js  # dataofjapan からGeoJSON生成（試作）
    ├── strip-holes.js          # 内部リング除去バッチ
    ├── verify.js               # データ検証
    └── upload-r2.sh            # R2アップロード（現在未使用）
```

---

## 現在の状態

### 完成している機能
- 59市区町村ゲームロジック（藩作成・確定・undo・やり直し）
- 全47都道府県データ（municipalities.json / adjacency.json）
- 全47都道府県のGeoJSONポリゴン（`data/XX/boundaries.geojson`）
- 県境隣接データ（`data/cross/`、120ファイル）
- 多県同時プレイ（`?prefs=04,07` などURLパラメータ）
- スコア計算・コスト試算・税収表示
- AI講評（Cloudflare Functions経由、Claude Haiku）
- PDFレポート生成
- 遊び方モーダル

### 直近のバグ修正履歴（2026-03-22）

| コミット | 内容 |
|---|---|
| aa11534 | **バッファ+union で断片統合**（78,575→2,616サブポリゴン） |
| e373c50 | 極小アーティファクトポリゴン除去（4,624個） |
| 6201b25 | `fillRule: 'nonzero'` で自己交差ポリゴン対策 |
| fa89726 | 内部リング（穴）除去（2,025個） |
| 46d95fe | geojsonUrlを静的パスに変更（R2 Function不要に） |

### 現在のポリゴン品質

- **福島（07）**: MultiPolygon 0件。全59市区町村が単一Polygon
- **宮城（04）**: 利府町・仙台市各区など内陸部は単一Polygon。石巻市(18島)・松島町(7島)等は本物の島嶼でMultiPolygon
- **未確認**: ユーザーが「まだ虫食いが多い」と言っていたが最新修正後は未検証

---

## 残っている問題・積み残し

### 優先度: 高

#### 1. ポリゴン虫食いの最終確認
最新デプロイ（aa11534）後のポリゴン表示をユーザーに確認してもらう必要がある。
改善方法: ハードリフレッシュ（Cmd+Shift+R）後に `https://haiken-chihan.pages.dev/` と `?pref=04` で確認。

#### 2. ANTHROPIC_API_KEY の再設定
AI講評機能が動くかどうか未確認。Cloudflare Pagesの環境変数に設定されているか要確認。
- Dashboard → Pages → haiken-chihan → Settings → Environment variables

### 優先度: 中

#### 3. Phase C: ランディングページ（`landing.html`）
都道府県選択UIが未着手。現状は手動で `?pref=04` と打つ必要がある。

設計方針（`design.md` 参照）:
- 日本地図（SVGまたはLeaflet）で都道府県をクリック選択
- 選んだ県の隣接県を自動でハイライト・推奨
- プリセット（東北6県・近畿2府4県等）
- 「プレイ開始」ボタンで `index.html?prefs=04,06,07,03,...` に遷移

#### 4. Phase D: ゲーム中の範囲拡張
ゲームプレイ中に「＋ 隣接県を追加」ボタンで範囲を広げる機能。

#### 5. ヘッダーのサブタイトル修正
現在「福島県 59市町村 → 新しい藩へ」と固定表示されている。多県対応時に動的に更新されているか確認が必要。

### 優先度: 低

#### 6. 市区町村コード不整合（23件）
仕様書由来のコードがJIS標準コードと異なる。名前マッチングで回避済みのため実害なし。

#### 7. Netlify削除
Cloudflare移行後も旧Netlifyサイトが残っている。削除で良い。

---

## ゲームロジック重要ポイント

### URLパラメータ
```
?pref=07          # 福島県のみ（デフォルト）
?prefs=04,07      # 宮城・福島の2県
?prefs=01,02,03   # 北海道・青森・岩手
```

### データロードの流れ（index.html の `initGame()`）
1. `data/prefectures.json` → 都道府県メタ情報
2. `data/XX/municipalities.json` × 県数 → 市区町村リスト（MUNICIPALITIES配列）
3. `data/XX/adjacency.json` × 県数 → 隣接ペア
4. `data/cross/XX_YY.json` × 組み合わせ数 → 県境隣接
5. `initMap()` → Leaflet地図初期化 → `loadGeoJSON()` → GeoJSONポリゴン描画

### GeoJSONマッチング（`renderGeoJSON()`）
- **名前優先**: `feature.properties.name === m.name`
- **コードフォールバック**: `findMuniByCode(feature.properties.code)`
- マッチしない場合は `addFallbackMarker()` でCircleMarker

---

## Cloudflare設定

### Pages設定（`wrangler.toml`）
```toml
name = "haiken-chihan"
pages_build_output_dir = "."
[[r2_buckets]]
binding = "GEOJSON"
bucket_name = "haiken-geojson"
```

### 環境変数（Pages Dashboard で設定）
- `ANTHROPIC_API_KEY` — Claude API キー（AI講評に必要）

### デプロイ
GitHub の `main` ブランチへのpushで自動デプロイ。

---

## データ生成スクリプトの使い方

```bash
# 特定の都道府県を再生成（e-Stat APIキーが必要）
ESTAT_APPID=xxxxx node scripts/generate-pref-data.js 07

# 全47都道府県を再生成
ESTAT_APPID=xxxxx node scripts/generate-all.js --skip-cross

# 穴除去のみ（再生成不要）
node scripts/strip-holes.js

# 県境隣接データの再生成
node scripts/generate-cross-adj.js
```

---

## GeoJSONポリゴン品質の技術的背景

### 問題の経緯
e-Stat GISのシェープファイルは**小地域（丁目・大字）レベル**のデータ。これを市区町村レベルに集約する際に以下の問題が発生していた：

1. **内部リング（穴）**: turf.union の副作用 → `strip-holes.js` で解決
2. **極小アーティファクト**: 面積ほぼゼロのポリゴン → 0.000001deg²未満を除去
3. **断片化（最大の問題）**: 小地域間の微小な隙間でunionが失敗 → **80mバッファ+union** で解決

### 現在のデータ生成フロー（`generate-pref-data.js`）
```
e-Stat shapefile ダウンロード
  → 小地域ポリゴンを市区町村コードでグループ化
  → ≤50個: turf.union で結合
  → >50個: MultiPolygonとして収集
  → turf.simplify（tolerance=0.0002）
  → stripHoles()（内部リング除去）
  → 保存
```

その後 `strip-holes.js` と バッファ統合スクリプト（スタンドアロン）でポストプロセス済み。

---

## 参考資料

- `design.md` — UI/UX設計書（Phase A〜E のロードマップ含む）
- `haiken-chihan-spec.md` — 元の仕様書
- e-Stat API: statsDataId=0003433219（人口）、0003173281（税収）
- dataofjapan/land: fukushima.geojson と tokyo.geojson のみ（全国版は都道府県レベル）

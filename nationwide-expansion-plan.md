# 廃県置藩シミュレーター 全国展開 実装計画書 v3

作成日: 2026-03-20

---

## 確定した設計決定

| 項目 | 決定内容 |
|------|----------|
| 政令市の区 | 市町村として扱う（「港北区」「天王寺区」が独立した市町村） |
| 東京23区 | 市町村として扱う（「千代田区」「新宿区」が独立） |
| 小規模市町村 | そのまま1市町村として扱う。人口不足は特区ルールでカバー |
| 非隣接ルール | 陸続きでない市町村は同じ藩に組み込めない（既存ルール維持） |
| 離島の扱い | **ゲームエリア内に隣接市町村が存在しない市町村は「孤立」状態 → どの藩にも自由に組み込める** |
| 沖縄 | 離島扱いしない。県内隣接ルールが適用される（離島は孤立判定次第） |

---

## 離島ルールの詳細設計

「離島」という静的フラグは持たない。代わりに**動的孤立判定**を採用する。

```
孤立市町村 = 現在のゲームエリア（選択された県の組み合わせ）内で
             隣接市町村が1つも存在しない市町村
```

**例**:
- 小笠原村（東京都）: 東京都を単独選択 → 本土の市区町村と隣接なし → 孤立 → どの藩にも組み込める
- 奄美市（鹿児島県）: 鹿児島県単独 → 本土と隣接なし → 孤立 → 自由配置
- 与那国町（沖縄県）: 沖縄県選択 → 石垣島等と隣接あり → 通常ルール
- 沖縄本島の市町村: 沖縄県選択 → 互いに隣接あり → 通常ルール

**実装**:
```javascript
// ゲーム開始時に孤立市町村を特定
state.isolatedMunis = new Set(
  state.municipalities
    .filter(m => getNeighbors(m.code).length === 0)
    .map(m => m.code)
);

// 藩への追加可否判定
function canAddToHan(muniCode, han) {
  if (state.isolatedMunis.has(muniCode)) return true; // 孤立市町村は自由
  return isAdjacentToHan(muniCode, han);               // 通常は隣接チェック
}
```

これにより「沖縄県＋鹿児島県」を選択したとき、奄美諸島と沖縄北部の島が
実際に隣接していれば自動的に通常ルールになる。

---

## GeoJSONソースの変更（重要）

### 判明した問題

dataofjapan/land には **fukushima.geojson と tokyo.geojson の2県しか存在しない**。
`japan.geojson` は都道府県境界のみ（47フィーチャー）。市区町村レベルではない。

### 採用するソース

**`niiyz/JapanCityGeoJson`（GitHub）**

```
https://raw.githubusercontent.com/niiyz/JapanCityGeoJson/master/geojson/prefectures/{2桁コード}.json
```

- 全47都道府県 × 市区町村ポリゴン対応
- **政令市の区・東京23区が独立フィーチャーとして含まれる**
- GeoJSON形式（そのまま使える）
- properties例: `{ "N03_001": "福島県", "N03_004": "福島市", "N03_007": "07201" }`
  - `N03_004`: 市区町村名（区の場合「横浜市港北区」等）
  - `N03_007`: 5桁JISコード

### Leaflet側の対応

現在の `loadGeoJSON()` は dataofjapan/land の `nam_ja` プロパティを使っている。
niiyz/JapanCityGeoJson では `N03_004` に変更が必要。

```javascript
// Before（dataofjapan/land）
const name = feature.properties.nam_ja;

// After（niiyz/JapanCityGeoJson）
const name = feature.properties.N03_004;  // 例: "福島市", "千代田区"
const code = feature.properties.N03_007;  // 例: "07201"
```

### Fukushima GeoJSONの移行

現在使用中の `dataofjapan/land/fukushima.geojson` から
`niiyz/JapanCityGeoJson` に移行。
**これにより福島のコード・名称マッピングも修正が必要。**

---

## ファイル構造

```
haiken-chihan/
  index.html               ← ゲームエンジン
  landing.html             ← プレイエリア選択
  data/
    prefectures.json       ← 47都道府県メタ情報（GeoJSON URL含む）
    01/                    ← 北海道
      municipalities.json  ← { code, prefCode, name, population, taxRevenue, lat, lng }
      adjacency.json       ← ["01100_01202", ...]
    02/                    ← 青森
    ...（47都道府県）
    cross/                 ← 県境隣接ペア（隣接する県ペアのみ、約94ファイル）
      02_03.json           ← 青森-岩手
      03_04.json           ← 岩手-宮城
      04_07.json           ← 宮城-福島
      ...
  scripts/
    generate-pref-data.js  ← 1県分データ生成
    generate-cross-adj.js  ← 県境隣接ペア生成
    generate-all.js        ← 全件一括実行
    fetch-estats.js        ← e-Stat APIヘルパー
    verify.js              ← 隣接リスト品質確認
  netlify/functions/ai.js
  package.json
```

### municipalities.json フォーマット

```json
[
  {
    "code": "07201",
    "prefCode": "07",
    "name": "福島市",
    "population": 273964,
    "taxRevenue": 29876543000,
    "lat": 37.7608,
    "lng": 140.4748,
    "region": "中通り"
  },
  {
    "code": "13101",
    "prefCode": "13",
    "name": "千代田区",
    "population": 66680,
    "taxRevenue": 85400000000,
    "lat": 35.6940,
    "lng": 139.7536,
    "region": null
  }
]
```

`isIsolated` フラグは持たない（動的判定）。
`region` は福島の「中通り・浜通り・会津」のような地域分類。他県はnullでよい。

### prefectures.json フォーマット

```json
[
  {
    "code": "07",
    "name": "福島県",
    "region": "東北",
    "geojsonUrl": "https://raw.githubusercontent.com/niiyz/JapanCityGeoJson/master/geojson/prefectures/07.json",
    "municipalityCount": 59,
    "totalPopulation": 1834498,
    "bounds": {
      "minLng": 138.72, "maxLng": 141.18,
      "minLat": 36.72, "maxLat": 38.08
    },
    "status": "available"
  }
]
```

bounds は generate スクリプトが GeoJSON から自動計算する。

---

## セーブ・ロード設計

### セーブデータ構造

```javascript
{
  version: 2,
  savedAt: "2026-03-21T10:30:00Z",
  name: "三陸沿岸プレイ",       // ユーザーが付けた名前
  prefCodes: ["03", "04", "07"],
  targetPopulation: 380000,
  gameState: {
    hans: [...],               // 確定済み藩
    assignments: {...},        // muniCode → hanId
    hanCounter: 7,
    currentHan: null,          // 編集中の藩
  }
}
```

- localStorage キー: `haiken_saves`（配列、最大5スロット）
- スロット0: 自動セーブ専用（確定操作のたびに上書き）
- スロット1〜4: 手動セーブ

### UI

**ヘッダーボタン追加**:
```
[？ 遊び方]  [💾 保存]  [📂 再開]  ← 追加
```

**保存モーダル**: スロット選択 + 名前入力
**再開モーダル**: セーブリスト（保存名・県名・確定藩数・日時）
**自動セーブ**: 藩確定・やり直しのたびに静かにスロット0へ

landing.html にも「前回の続きを再開」ボタンを表示。

---

## プレイエリア選択 landing.html

### 日本地図クリックUI

SVGまたはCanvasで日本の都道府県地図を表示。
クリックで選択・解除。選択中は色付き。

```
プリセット: [東北6県] [三陸3県（岩手・宮城・福島）] [関東7都県] [近畿2府4県] [九州7県] [全国]
```

### ゲームエリアの統計表示

選択した県の合計:
- 市区町村数: XXX
- 総人口: 約XX万人
- 目標人口（1藩あたり）: 約XX万人（自動計算）
- 孤立市町村数: XX（遊び方の説明とともに表示）

### 非隣接組み合わせの扱い

「陸続きでない県の組み合わせ」= 警告のみ表示（禁止しない）。
内部では cross/ ファイルがなければ単に県境隣接ペアがないだけ。
各県の市町村が孤立判定を受け、自由配置ルールが適用される。

---

## データ生成スクリプト設計

### generate-pref-data.js

```bash
node scripts/generate-pref-data.js 07
# → data/07/municipalities.json
# → data/07/adjacency.json
```

**処理フロー**:
1. `niiyz/JapanCityGeoJson` から `{code}.json` をフェッチ
2. 各 Feature から name（N03_004）・code（N03_007）を抽出
3. centroid（重心）から lat/lng を計算
4. e-Stat API で人口取得 → 名前マッチング → population
5. e-Stat API で税収取得 → taxRevenue
6. Turf.js で県内の隣接ペアを計算
7. 出力

**名前マッチング戦略**:
```
GeoJSON: "横浜市港北区" ←→ e-Stat: "横浜市港北区"  → 完全一致
GeoJSON: "富士山麓外輪山村" ←→ e-Stat: "富士山麓外輪山" → 末尾の「村」を除去して一致
失敗した市町村 → name-fixes/{prefCode}.json に手動マッピングを記述
```

### generate-cross-adj.js

```bash
node scripts/generate-cross-adj.js 04 07
# → data/cross/04_07.json（宮城-福島の県境隣接ペア）
```

**処理フロー**:
1. 2県分の GeoJSON をフェッチ・統合
2. 全ペア（片方がA県、片方がB県）を Turf.js で隣接判定
3. 出力

### generate-all.js

全47都道府県 + 全隣接県ペアを一括生成。
隣接する県のペアリストを内部で持つ（約94ペア）。

### 隣接判定アルゴリズム

```javascript
// 許容誤差: 県内0.0001度、県境0.001度（GeoJSONの精度差を吸収）
function areAdjacent(featureA, featureB, tolerance) {
  // 共有座標が2点以上あれば隣接（辺を共有）
  const coordsA = flatCoords(featureA); // MultiPolygon対応で全座標展開
  const coordsB = flatCoords(featureB);
  let shared = 0;
  for (const a of coordsA) {
    for (const b of coordsB) {
      if (Math.abs(a[0]-b[0]) < tolerance && Math.abs(a[1]-b[1]) < tolerance) {
        if (++shared >= 2) return true;
      }
    }
  }
  return false;
}
```

県境は精度が荒い場合があるため、tolerance を大きめに設定し
フォールバックで `turf.booleanTouches` も試みる。

---

## ゲームエンジン変更点（index.html）

### 変更の範囲

ゲームロジックはほぼ変更なし。変更は**初期化・データロード・UI追加のみ**。

### initGame（新）

```javascript
async function initGame(prefCodes) {
  // 1. 市町村データを全県まとめてロード
  const muniArrays = await Promise.all(
    prefCodes.map(c => fetch(`data/${c}/municipalities.json`).then(r => r.json()))
  );
  state.municipalities = muniArrays.flat();
  state.prefCodes = prefCodes;

  // 2. 隣接リストを統合（県内 + 県境）
  const adjFiles = [
    ...prefCodes.map(c => `data/${c}/adjacency.json`),
    ...getCrossPairs(prefCodes).map(([a,b]) => `data/cross/${a}_${b}.json`),
  ];
  const adjArrays = await Promise.all(
    adjFiles.map(url => fetch(url).then(r => r.json()).catch(() => []))
  );
  state.adjacency = new Set(adjArrays.flat());

  // 3. 孤立市町村を特定（動的）
  state.isolatedMunis = new Set(
    state.municipalities
      .filter(m => getNeighbors(m.code, state.adjacency).length === 0)
      .map(m => m.code)
  );

  // 4. 複数県のGeoJSONをロード・マージ
  await loadGeoJSONMulti(prefCodes);

  // 5. 目標人口を自動計算
  const totalPop = state.municipalities.reduce((s,m) => s + m.population, 0);
  state.targetPopulation = calcTargetPopulation(totalPop);
}
```

### 目標人口の計算

```javascript
function calcTargetPopulation(totalPop) {
  const idealCount = Math.max(3, Math.round(totalPop / 400000));
  return Math.round(totalPop / idealCount);
  // 東北6県 870万人 → 22藩 → 目標39.5万
  // 鳥取+島根 122万人 → 3藩 → 目標40.7万
  // 関東7都県 4300万人 → 107藩（多すぎ → 上限を設ける or 100万/藩モードも可）
}
```

### GeoJSONプロパティの変更

`N03_004`（市区町村名）・`N03_007`（コード）でマッチング。
政令市の区: `N03_004` = "横浜市港北区"、`N03_007` = "14117"

---

## フェーズ別実装計画

### Phase 0: リファクタリング（必須先行）

**目標**: 福島をJSONに外部化し、全基盤を整える

1. `data/07/municipalities.json`（MUNICIPALITIES + MUNI_TAX統合）を手作業で作成
2. `data/07/adjacency.json` を手作業で作成（現在のADJACENCYをJSON配列化）
3. `data/prefectures.json` 作成（福島のエントリのみ）
4. index.html を `initGame(['07'])` 方式にリファクタリング
5. URLパラメータ `?prefs=07` 対応
6. GeoJSONプロパティを niiyz/JapanCityGeoJson 形式（N03_004/N03_007）に移行
7. **セーブ・ロード基本実装**（localStorage、保存/再開ボタン）
8. 動作確認（福島で全機能動作）

**期間**: 1〜2日

---

### Phase 1: データ生成スクリプト

**目標**: `node scripts/generate-pref-data.js 07` で福島JSONが再現できる

1. package.json に devDependencies 追加（@turf/turf, node-fetch）
2. `fetch-estats.js` 実装（人口・税収API）
3. `generate-pref-data.js` 実装
4. 福島で実行 → Phase 0 の手作業JSONと照合
5. 差分修正・許容誤差チューニング

**期間**: 2〜3日

---

### Phase 2: 県境隣接スクリプト + 多県プレイ検証

**目標**: 福島+宮城の2県プレイが動作する

1. `generate-cross-adj.js` 実装
2. 宮城（04）のデータ生成
3. `data/cross/04_07.json` 生成・確認
4. `index.html?prefs=04,07` で2県プレイ試験
5. 孤立判定ロジック確認

**期間**: 1日

---

### Phase 3: 全都道府県データ生成

**目標**: 47都道府県 + 全県境ペアのJSONを生成

1. `generate-all.js` 実装・実行
2. e-Stat マッチング失敗リストの修正（`name-fixes/`ディレクトリ）
3. 東京（23区+多摩+島嶼）の動作確認
4. 北海道（179市町村）の性能確認
5. `verify.js` で孤立市町村・隣接数の統計確認

**期間**: 2〜3日

---

### Phase 4: landing.html

**目標**: 都道府県クリック選択 + セーブ再開UIを実装

1. SVG日本地図で都道府県選択
2. プリセットボタン（東北・三陸・関東等）
3. 選択エリアの統計表示
4. セーブデータからの再開
5. `index.html?prefs=03,04,07` 形式でURLに渡す

**期間**: 1〜2日

---

### Phase 5: セーブ・ロード完成 + スコア調整

1. 保存モーダル・再開モーダルのUI完成
2. 自動セーブの動作確認
3. 複数県プレイのスコアバランス確認
4. AI講評のプロンプトを複数県対応に更新

**期間**: 1日

---

## リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| niiyz/JapanCityGeoJson の精度 | 隣接未検出・誤検出 | Phase 1で福島を検証、許容誤差調整 |
| niiyz/JapanCityGeoJson の欠損・廃止 | GeoJSON取得不能 | 国土数値情報をフォールバックとして準備 |
| 政令市の区のコード体系 | e-Statとの名前マッチング失敗 | name-fixes.jsonで手動補正 |
| 関東プレイ（107藩）の規模 | ゲームバランス崩壊 | 目標人口の上限設定 or 難易度選択 |
| 大規模エリアでのLeaflet性能 | 200〜300ポリゴンで遅延 | 問題なし（1000以下は快適） |
| セーブデータのJSON更新後陳腐化 | ロード時のデータ不整合 | version + マイグレーション関数 |

---

## 未解決・要調査事項

1. **niiyz/JapanCityGeoJson の実際の構造確認**（Phase 0着手時に調査）
   - 政令市の区がN03_004に含まれるか
   - 東京23区のコードが正しいか
   - 全47都道府県が揃っているか

2. **関東プレイの上限設計**
   - 関東7都県: 約317市区町村、約4300万人 → 107藩が理想？
   - あまりにも多いなら「広域モードは500万人以上の県は上限を設ける」などの仕様追加を検討

3. **全国モード（47都道府県）の可能性**
   - 技術的には可能
   - 1,800市区町村、約1億2000万人
   - 「チャレンジモード」として将来追加

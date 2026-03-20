# 廃県置藩シミュレーター｜次期実装計画書

**作成日:** 2026年3月
**対象ファイル:** haiken-chihan.html（現状）→ Netlify構成へ移行

---

## デプロイ構成（全フェーズ共通の前提）

### 現状 → 目標構成

```
# 現状
haiken-chihan.html（単一ファイル）

# 目標
haiken-chihan/
├── index.html               ← haiken-chihan.htmlをリネーム
├── netlify.toml             ← Netlify設定
└── netlify/functions/
    └── ai.js                ← Claude APIプロキシ（Phase 3で追加）
```

### netlify.toml（最小構成）
```toml
[build]
  publish = "."

[[redirects]]
  from = "/api/ai"
  to = "/.netlify/functions/ai"
  status = 200
```

### Netlify Functionsのプロキシ構造（ai.js）
```javascript
const Anthropic = require("@anthropic-ai/sdk");

exports.handler = async (event) => {
  const { prompt, system } = JSON.parse(event.body);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: msg.content[0].text }),
  };
};
```

### デプロイ手順（一度だけ）
1. GitHubにリポジトリ作成、ファイルをpush
2. Netlify で "Import from GitHub" → 自動ビルド
3. Netlify Dashboard → Site settings → Environment variables に `ANTHROPIC_API_KEY` を設定
4. 以降はmainブランチにpushするだけで自動デプロイ

---

## Phase 1: ゲームUX改善（難易度: 低）

### 1-1. 確定済み藩のリネーム

**概要:** サイドパネルの確定済み藩カードに「✏」ボタンを追加。クリックで名前入力ダイアログを再表示。

**変更箇所:** `updateSidebar()` の hanCard HTML + `renameHan(hanId)` 関数追加

```javascript
// 追加する関数
function renameHan(hanId) {
  const han = state.hans.find(h => h.id === hanId);
  if (!han) return;
  document.getElementById('nameInput').value = han.name;
  document.getElementById('nameDialog').classList.add('show');
  document.getElementById('nameOverlay').classList.add('show');
  document.getElementById('nameInput').focus();
  document.getElementById('nameInput').select();
  // submitHanName の代わりに renameSubmit を呼ぶよう一時フラグで制御
  state.renamingHanId = hanId;
}
```

**UIイメージ:**
```
┌─────────────────────────┐
│ 福島藩                  ✏│  ← ✏ボタン追加
│ 28.3万人（5市町村）      │
│ 適正                    │
└─────────────────────────┘
```

---

### 1-2. 確定済み藩のやり直し（解除）

**概要:** 藩カードに「↩」ボタンを追加。クリックで確定を取り消し、市町村をアンアサインして再編集可能に。

**注意:** 解除した藩のメンバーを全て`state.assignments`から削除するか、そのまま「未確定」状態に戻すか。
→ **推奨: 未確定状態に戻す**（市町村の割り当ては残し、`confirmed: false` にするだけ）

```javascript
function undoHan(hanId) {
  const han = state.hans.find(h => h.id === hanId);
  if (!han) return;
  han.confirmed = false;
  state.currentHanId = hanId;  // 編集中に戻す
  updateAllStyles();
  updateSidebar();
}
```

---

### 1-3. 特区機能（人口30万未満の藩への理由付け）

**概要:** 人口30万未満の藩を確定しようとすると「特区設定」ダイアログを挟む。理由を選ぶことで確定可能に。スコアは人口減点なしになる特別扱い（または小減点）。

**特区カテゴリ（プルダウン候補）:**

| カテゴリ | 説明 |
|---|---|
| 水源・自然保護特区 | 水源涵養林・国立公園の保全を優先 |
| 農業・食料生産特区 | 広大な農地・コメ生産地帯 |
| 漁業・水産特区 | 沿岸漁業・養殖業の拠点 |
| 観光・文化特区 | 温泉・歴史遺産・スキーリゾート等 |
| 原子力復興特区 | 原発立地・廃炉推進・エネルギー産業 |
| 国境・防衛特区 | 地理的に重要な辺境地域 |
| 自由記述 | プレイヤーが独自理由を入力 |

**UIフロー:**
1. 人口30万未満で「確定」ボタン押下
2. 特区設定ダイアログ表示（「理由なしで確定」も選べる）
3. 選択・入力後に確定 → 藩カードに特区バッジ表示

**スコア影響案:**
- 特区あり: 人口減点を半減（妥当な理由があるので）
- 特区なし（30万未満のまま確定）: 現状通り減点

```html
<!-- 特区ダイアログ -->
<div class="tokku-dialog" id="tokkuDialog">
  <h3>人口が30万人未満です</h3>
  <p>この地域を「特区」として設定しますか？</p>
  <select id="tokkuType">
    <option value="">-- 特区設定なし --</option>
    <option value="water">水源・自然保護特区</option>
    <option value="agri">農業・食料生産特区</option>
    <option value="fish">漁業・水産特区</option>
    <option value="tourism">観光・文化特区</option>
    <option value="nuclear">原子力復興特区</option>
    <option value="border">国境・防衛特区</option>
    <option value="custom">自由記述...</option>
  </select>
  <input type="text" id="tokkuCustom" placeholder="特区の理由を入力" style="display:none;">
  <button onclick="confirmWithTokku()">確定</button>
</div>
```

---

## Phase 2: データ拡充（難易度: 中）

### 2-1. e-Statから市町村税収データ取得

**目的:** 各藩の「財政規模」を可視化する。藩を組むとき税収バランスも考慮できる。

**データソース候補（e-Stat）:**
- 市町村税収: 総務省「市町村税課税状況等の調」→ statsDataId要調査
- 地方財政状況調査（決算カード）→ `statsDataId=0003410386` 付近

**表示イメージ（クリア画面）:**
```
【廃県置藩 後】3藩
  首長・議員報酬:  約 X.X億円/年
  施設維持費:      約 X.X億円/年
  藩の税収試算:    約 XXX億円/年  ← 追加
  財政自立度:      XX%            ← 追加
```

**実装ステップ:**
1. e-Stat APIで市町村別税収データのstatsDataIdを特定
2. MUNICIPALITIESに `taxRevenue` フィールドを追加
3. 藩の税収合計をサイドパネル・クリア画面に表示

---

## Phase 3: AI機能（難易度: 中〜高）

**前提:** Netlify Functions経由でClaude API呼び出し（Phase 0のデプロイ構成が必要）

### 3-1. スコア全体の寸評

**概要:** ゲームクリア後のスコア下に、AIが藩編成全体を評価するコメントを表示。

**プロンプト設計:**
```
system: "あなたは江戸時代の藩政に詳しい歴史家です。プレイヤーが福島県を再編した藩構成を
評価してください。短く・ユーモアを交えて・時代劇風の言葉遣いで。200字以内。"

user: "プレイヤーが作った藩は以下の通りです：
- 福島藩（福島市・伊達市など5市町村, 28万人, 特区なし）
- 会津藩（会津若松市など8市町村, 32万人, 特区なし）
...
スコアは1450点でした。この藩編成を評価してください。"
```

---

### 3-2. 藩ごとのAI特徴コメント

**概要:** クリア画面の各藩サマリーに、AIが生成した「藩の特徴・概要」コメントを追加。

**プロンプト設計:**
```
system: "福島県の地理・産業・文化に詳しいアナリストとして、新設される「藩」の特徴を
100字程度で端的に説明してください。地形、主要都市、産業、観光などの観点を含めてください。"

user: "以下の市町村で構成される藩の特徴を教えてください：
郡山市（32万人）, 須賀川市（7.5万人）, 本宮市（3万人）, 大玉村（0.9万人）
総人口: 43.4万人, 地域: 中通り中部"
```

**表示位置:** クリア画面の各藩サマリーアイテムの下

**取得タイミング:** `showGameClear()` 内で全藩分を並列リクエスト（Promise.all）

---

## Phase 4: レポート出力（難易度: 高）

### 4-1. PDFレポート生成

**ライブラリ:**
- `html2canvas` — 地図・UIをキャンバスに変換
- `jsPDF` — PDFに書き出し
- CDNで追加（ビルドツール不要）

**レポート構成:**
```
1ページ目: タイトル・スコア・総評（AI寸評）
2ページ目: 色分けされた藩の地図（html2canvasでキャプチャ）
3ページ目〜: 藩ごとの詳細
  - 藩名・人口・市町村一覧
  - AI特徴コメント
  - 行政コスト試算
  - （税収データ: Phase 2実装後）
  - 特区情報（設定した場合）
最終ページ: 行政コスト比較・削減額・免責事項
```

**技術的課題:**
- Leafletの地図キャプチャ: `map.getContainer()` を html2canvas に渡す。タイル画像のCORSに注意（国土地理院タイルはCORSヘッダーなし → `useCORS: false` で対処またはキャンバスレイヤーのみキャプチャ）
- 対策案: 地図キャプチャの代わりに、SVGで藩の色分けマップを独自描画してPDFに埋め込む

**実装アプローチ（段階的）:**
1. まず地図なしのテキスト+表のPDFを作る
2. 次にSVGで簡易地図（市町村ポリゴンの色分けのみ）を追加
3. 最後にLeafletキャプチャを試みる

---

## 実装順序まとめ

| フェーズ | 内容 | 工数目安 | 依存 |
|---|---|---|---|
| Phase 0 | Netlifyデプロイ設定 | 小 | なし |
| Phase 1-1 | 藩リネーム | 小 | なし |
| Phase 1-2 | 藩やり直し | 小 | なし |
| Phase 1-3 | 特区機能 | 中 | なし |
| Phase 2 | e-Stat税収データ | 中 | なし |
| Phase 3-1 | AIスコア寸評 | 中 | Phase 0 |
| Phase 3-2 | AI藩コメント | 中 | Phase 0, 3-1 |
| Phase 4 | PDFレポート | 大 | Phase 1〜3 |

---

*このドキュメントはClaude Codeによる実装委任用です。各Phaseは独立して実装可能です。*

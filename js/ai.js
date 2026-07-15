// ============================================================
// ai.js — AIプロキシ（/api/ai、バックエンドはGemini）呼び出しとプロンプト構築
// バックエンドは functions/api/ai.js（Cloudflare Pages Functions）
// ============================================================
import { getHanPopulation, getHanMembers, PREF_META } from './state.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Gemini無料枠はRPM制限があるため、429/503は待って再試行する
// opts.json=true でJSON強制モード（一括講評用）
export async function callAI(system, prompt, retries = 3, opts = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, prompt, json: !!opts.json }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.text && data.text.trim()) return data.text.trim();
      // 空応答はリトライ対象（たまにモデルが空白だけ返すことがある）
      if (attempt < retries) { await sleep(3000); continue; }
      throw new Error('AI empty response');
    }
    if ((res.status === 429 || res.status === 503) && attempt < retries) {
      await sleep(15000 * (attempt + 1)); // 15s, 30s, 45s
      continue;
    }
    throw new Error('AI API error ' + res.status);
  }
}

// ---- ゲームクリア後の AI コメント読み込み（非同期・非ブロック） ----
export function loadAIComments(confirmedHans, score) {
  // Overall review
  const hanList = confirmedHans.map(han => {
    const pop = getHanPopulation(han.id);
    const members = getHanMembers(han.id);
    const tokku = han.tokku ? `（${han.tokku.label}）` : '';
    return `・${han.name}: ${members.map(m => m.name).join('・')} 計${(pop / 10000).toFixed(1)}万人${tokku}`;
  }).join('\n');

  // 全体講評＋全藩コメントを1リクエストにまとめて取得（無料枠のRPM節約）。
  // レスポンスは {"overall": "...", "hans": {"han_1": "...", ...}} のJSON。
  const hanDetails = confirmedHans.map(han => {
    const members = getHanMembers(han.id);
    const pop = getHanPopulation(han.id);
    const prefNames = [...new Set(members.map(m => m.prefCode))].map(pc => {
      const p = PREF_META.find(x => x.code === pc);
      return p ? p.name : pc;
    }).join('・');
    const tokku = han.tokku ? `、特区: ${han.tokku.label}` : '';
    return `[${han.id}]「${han.name}」構成: ${members.map(m => m.name).join('、')}／総人口${(pop / 10000).toFixed(1)}万人／エリア: ${prefNames}${tokku}`;
  }).join('\n');

  const system =
    '地理と行政に詳しい現代のコメンテーターです。必ず次の形のJSONだけを出力してください: ' +
    '{"overall": "藩編成全体への講評（軽いユーモアを交えたカジュアルな口調、200字以内）", ' +
    '"hans": {"藩ID": "その藩の地形・主要産業・観光資源を含む80字程度の端的な説明", ...}}。' +
    '文字数カウントや前置きなどJSON以外の出力は禁止です。';
  const prompt =
    `プレイヤーが都道府県を「藩」に再編しました（スコア${score}点）。\n` +
    `全藩の一覧:\n${hanList}\n\n各藩の詳細（藩IDはこのカッコ内の文字列を使うこと）:\n${hanDetails}\n\n` +
    `overall と、全${confirmedHans.length}藩ぶんの hans を返してください。`;

  const fail = () => {
    document.getElementById('aiReview').style.display = 'none';
    confirmedHans.forEach(han => {
      const el = document.getElementById('ai-han-' + han.id);
      if (el) el.textContent = '（コメントを取得できませんでした）';
    });
  };

  callAI(system, prompt, 3, { json: true }).then(text => {
    // 保険: コードフェンス付きで返ってきた場合は剥がす
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const data = JSON.parse(cleaned);
    document.getElementById('aiReview').textContent = data.overall || '';
    confirmedHans.forEach(han => {
      const el = document.getElementById('ai-han-' + han.id);
      if (el) el.textContent = (data.hans && data.hans[han.id]) || '（コメントを取得できませんでした）';
    });
  }).catch(fail);
}

// ============================================================
// ai.js — AIプロキシ（/api/ai、バックエンドはGemini）呼び出しとプロンプト構築
// バックエンドは functions/api/ai.js（Cloudflare Pages Functions）
// ============================================================
import { getHanPopulation, getHanMembers, PREF_META } from './state.js';

export async function callAI(system, prompt) {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, prompt }),
  });
  if (!res.ok) throw new Error('AI API error');
  const data = await res.json();
  return data.text;
}

// ---- プロンプトテンプレート ---------------------------------
export const overallReviewSystem = () =>
  '地理と行政に詳しい現代のコメンテーターとして、プレイヤーが福島県を藩に再編した結果を評価してください。軽いユーモアを交えたカジュアルな口調で、200字以内でコメントしてください。';

export const overallReviewPrompt = (score, hanList) =>
  `プレイヤーの藩編成（スコア${score}点）：\n${hanList}\nこの藩編成を評価してください。`;

export const hanCommentSystem = () =>
  '日本の地理・産業・文化に詳しいアナリストとして、新設される「藩」の特徴を80字程度で端的に説明してください。地形・主要産業・観光資源などの観点を含めてください。';

export const hanCommentPrompt = (han, members, pop, prefNames, tokku) =>
  `「${han.name}」の構成市町村: ${members.map(m => m.name).join('、')}\n総人口: ${(pop / 10000).toFixed(1)}万人、エリア: ${prefNames}${tokku}`;

// ---- ゲームクリア後の AI コメント読み込み（非同期・非ブロック） ----
export function loadAIComments(confirmedHans, score) {
  // Overall review
  const hanList = confirmedHans.map(han => {
    const pop = getHanPopulation(han.id);
    const members = getHanMembers(han.id);
    const tokku = han.tokku ? `（${han.tokku.label}）` : '';
    return `・${han.name}: ${members.map(m => m.name).join('・')} 計${(pop / 10000).toFixed(1)}万人${tokku}`;
  }).join('\n');

  callAI(overallReviewSystem(), overallReviewPrompt(score, hanList)).then(text => {
    document.getElementById('aiReview').textContent = text;
  }).catch(() => {
    document.getElementById('aiReview').style.display = 'none';
  });

  // Per-han comments (parallel)
  confirmedHans.forEach(han => {
    const members = getHanMembers(han.id);
    const pop = getHanPopulation(han.id);
    const prefNames = [...new Set(members.map(m => m.prefCode))].map(pc => {
      const p = PREF_META.find(x => x.code === pc);
      return p ? p.name : pc;
    }).join('・');
    const tokku = han.tokku ? `、特区: ${han.tokku.label}` : '';
    callAI(hanCommentSystem(), hanCommentPrompt(han, members, pop, prefNames, tokku)).then(text => {
      const el = document.getElementById('ai-han-' + han.id);
      if (el) el.textContent = text;
    }).catch(() => {
      const el = document.getElementById('ai-han-' + han.id);
      if (el) el.style.display = 'none';
    });
  });
}

// AI講評プロキシ（Google Gemini API 版）
// フロントからの { system, prompt, json } を受け取り { text } を返す。
// 必要な環境変数: GEMINI_API_KEY（Cloudflare Pages の設定画面で登録）
// モデルは GEMINI_MODEL で上書き可能（省略時は gemini-flash-latest）。
// 本命モデルが混雑（429/503）や空応答のときは flash-lite に自動フォールバックする。

const FALLBACK_MODEL = 'gemini-flash-lite-latest';

async function askGemini(apiKey, model, system, prompt, json) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...(system ? { system_instruction: { parts: [{ text: system }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // json=true は一括講評用（全藩まとめて1リクエスト）。JSON強制＋トークン上限拡大
        generationConfig: json
          ? { maxOutputTokens: 8192, responseMimeType: 'application/json' }
          : { maxOutputTokens: 1024 },
      }),
    }
  );

  if (!res.ok) {
    return { ok: false, status: res.status, error: await res.text() };
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || '')
    .join('').trim() || '';
  if (!text) {
    return { ok: false, status: 502, error: 'Empty response from Gemini' };
  }
  return { ok: true, text };
}

export async function onRequestPost(context) {
  const apiKey = context.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'API key not configured' }, { status: 500 });
  }

  let system, prompt, json;
  try {
    ({ system, prompt, json } = await context.request.json());
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof prompt !== 'string' || prompt.length === 0 || prompt.length > 20000 ||
      (system != null && (typeof system !== 'string' || system.length > 8000))) {
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const primary = context.env.GEMINI_MODEL || 'gemini-flash-latest';
  const models = primary === FALLBACK_MODEL ? [primary] : [primary, FALLBACK_MODEL];

  try {
    let last = null;
    for (const model of models) {
      last = await askGemini(apiKey, model, system, prompt, json);
      if (last.ok) return Response.json({ text: last.text });
      // 混雑・レート制限・空応答は次のモデルへ。それ以外（認証エラー等）は即返す
      if (![429, 502, 503].includes(last.status)) break;
    }
    return Response.json({ error: last.error }, { status: last.status });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

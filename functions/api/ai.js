// AI講評プロキシ（Google Gemini API 版）
// フロントからの { system, prompt } を受け取り { text } を返す。
// 必要な環境変数: GEMINI_API_KEY（Cloudflare Pages の設定画面で登録）
// モデルは GEMINI_MODEL で上書き可能（省略時は gemini-flash-latest = 常に最新のFlash）

export async function onRequestPost(context) {
  const apiKey = context.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'API key not configured' }, { status: 500 });
  }

  let system, prompt;
  try {
    ({ system, prompt } = await context.request.json());
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof prompt !== 'string' || prompt.length === 0 || prompt.length > 20000 ||
      (system != null && (typeof system !== 'string' || system.length > 8000))) {
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const model = context.env.GEMINI_MODEL || 'gemini-flash-latest';

  try {
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
          generationConfig: { maxOutputTokens: 1024 },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return Response.json({ error: err }, { status: res.status });
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || '')
      .join('') || '';
    if (!text) {
      return Response.json({ error: 'Empty response from Gemini' }, { status: 502 });
    }
    return Response.json({ text });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

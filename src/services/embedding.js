const GEMINI_EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "text-embedding-004";

async function restEmbed(text) {
  const RAW_API_KEY = process.env.GEMINI_API_KEY || "";
  const API_KEY = RAW_API_KEY.replace(/^['"]|['"]$/g, '');
  if (!API_KEY) throw new Error('GEMINI_API_KEY missing');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent?key=${API_KEY}`;
  const body = {
    content: { parts: [{ text }] }
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 403 && txt.includes('unregistered callers')) {
      throw new Error('Gemini embeddings unauthorized: enable Generative Language API and use a server-side API key (no referrer restriction)');
    }
    throw new Error(`Gemini error: ${res.status} ${txt}`);
  }
  const json = await res.json();
  const vector = json?.embedding?.value || json?.embedding?.values || json?.data?.embedding?.values;
  if (!vector || !Array.isArray(vector)) throw new Error('Invalid embedding response');
  return vector;
}

export async function embedText(text) {
  return await restEmbed(text);
}

export async function embedBatch(texts) {
  const out = [];
  for (const t of texts) out.push(await embedText(t));
  return out;
}

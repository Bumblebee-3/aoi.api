const MISTRAL_ENDPOINT = process.env.MISTRAL_ENDPOINT || 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-small-latest';

function buildSystemPrompt(contextBlocks) {
  const constraints = [
    'You are an aoi.js support assistant made by Bumblebee_3 who is a developer at https://aoi.js.org .',
    'Answer using ONLY the provided documentation context.',
    'If an answer is not present in the context, reply exactly: "This is not documented in the official aoi.js documentation."',
    'Do not invent syntax or functions. Be clear and correct.',
  ].join('\n');
  const context = contextBlocks.map((b, i) => `Source ${i + 1} (${b.file_path}${b.section_title ? ' - ' + b.section_title : ''}):\n${b.content}`).join('\n\n');
  const maxChars = Number(process.env.MAX_CONTEXT_CHARS || 12000);
  const trimmedContext = context.length > maxChars ? context.slice(0, maxChars) : context;
  return `${constraints}\n\nContext:\n${trimmedContext}`;
}

export async function generateAnswer({ question, contextBlocks, maxTokens = 400 }) {
  if (!process.env.MISTRAL_API_KEY) throw new Error('MISTRAL_API_KEY missing');
  const body = {
    model: MISTRAL_MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(contextBlocks) },
      { role: 'user', content: question }
    ],
    temperature: Number(process.env.MISTRAL_TEMPERATURE || 0.2),
    max_tokens: Math.min(Number(maxTokens || 400), 800)
  };

  const res = await fetch(MISTRAL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Mistral API error: ${res.status} ${txt}`);
  }
  const json = await res.json();
  const answer = json?.choices?.[0]?.message?.content || '';
  return answer.trim();
}

import { embedText } from './embedding.js';
import { vectorStore } from './vectorStore.js';

export async function searchByText(query, { k = 8 } = {}) {
  const qEmbedding = await embedText(query);
  const results = vectorStore.search(qEmbedding, { k });
  return results;
}

export function filterFunctionResults(funcName, results) {
  const lname = funcName.toLowerCase();
  return results.filter(r => {
    const p = r.file_path || '';
    const fn = p.toLowerCase();
    const base = fn.split('/').pop();
    return fn.includes('/functions/') && (fn.includes(lname) || (base && base.includes(lname)) || r.content.toLowerCase().includes(`$${lname}`));
  });
}

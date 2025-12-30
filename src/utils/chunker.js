import crypto from 'node:crypto';

const MIN_TOKENS = 300;
const MAX_TOKENS = 700;
const MIN_CHARS = MIN_TOKENS * 5; //1500 chars
const MAX_CHARS = MAX_TOKENS * 5; //3500 chars

export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function extractSections(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let currentTitle = 'Untitled';
  let buffer = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const content = buffer.join('\n').trim();
    if (content) sections.push({ title: currentTitle, content });
    buffer = [];
  };

  for (const line of lines) {
    const m = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
    if (m) {
      flush();
      currentTitle = m[1].trim();
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

export function chunkSection(sectionText) {
  const text = sectionText.trim();
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let acc = '';

  const pushAcc = () => {
    const c = acc.trim();
    if (!c) return;
    if (c.length < MIN_CHARS && chunks.length > 0) {
      const prev = chunks.pop();
      acc = (prev.content + '\n\n' + c);
    } else {
      chunks.push({ content: c });
      acc = '';
    }
  };

  for (const p of paragraphs) {
    const para = p.trim();
    if (!para) continue;
    if ((acc + '\n\n' + para).length <= MAX_CHARS) {
      acc = acc ? acc + '\n\n' + para : para;
    } else {
      pushAcc();
      if (para.length <= MAX_CHARS) {
        acc = para;
      } else {
        let start = 0;
        while (start < para.length) {
          const end = Math.min(start + MAX_CHARS, para.length);
          const slice = para.slice(start, end);
          chunks.push({ content: slice });
          start = end;
        }
        acc = '';
      }
    }
  }
  pushAcc();
  return chunks.map(c => ({ ...c, hash: sha256(c.content) }));
}

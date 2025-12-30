import path from 'node:path';

export function relativeDocPath(absPath) {
  if (!absPath) return '';
  const idx = absPath.indexOf('/website/');
  if (idx !== -1) return absPath.slice(idx + '/website/'.length);
  const alt = absPath.indexOf('/src/content/docs/');
  if (alt !== -1) return absPath.slice(alt);
  return path.basename(absPath);
}

export function normalizeFuncName(name) {
  if (!name) return '';
  const n = String(name).trim();
  return n.startsWith('$') ? n.slice(1).toLowerCase() : n.toLowerCase();
}

export function extractFunctionMetadata(funcName, chunks) {
  const data = {
    function: `$${funcName}`,
    syntax: null,
    description: null,
    parameters: null,
    examples: [],
    sources: [],
  };

  const namePattern = new RegExp(`\\$${funcName}\\s*\\[`);
  const syntaxHeading = /^(\s{0,3}#{1,6}\s+Syntax)/mi;
  const paramsHeading = /^(\s{0,3}#{1,6}\s+Parameters)/mi;
  const descHeading = /^(\s{0,3}#{1,6}\s+Description)/mi;

  for (const c of chunks) {
    const content = c.content || '';
    const rel = relativeDocPath(c.file_path);
    if (rel) data.sources.push(rel);

    if (!data.description) {
      const fm = content.match(/^\s*---\n([\s\S]*?)\n---/);
      if (fm) {
        const fmBody = fm[1];
        const m = fmBody.match(/(^|\n)description:\s*(.+)/i);
        if (m) {
          const val = m[2].trim().replace(/^"|^'|"$|'$/g, '');
          if (val) data.description = val.slice(0, 600);
        }
      }
    }

    const direct = content.match(new RegExp(`\\$${funcName}\\s*\\[[^\n\r]+`, 'i'));
    if (!data.syntax && direct) {
      data.syntax = direct[0].trim();
    }

    if (!data.syntax && syntaxHeading.test(content)) {
      const m = content.split(/\n/).find(l => l.trim().startsWith(`$${funcName}`));
      if (m) data.syntax = m.trim();
    }

    if (!data.description && descHeading.test(content)) {
      const lines = content.split(/\n/);
      const idx = lines.findIndex(l => descHeading.test(l));
      if (idx !== -1) {
        const descLines = [];
        for (let i = idx + 1; i < lines.length; i++) {
          const line = lines[i];
          if (/^\s{0,3}#{1,6}\s+/.test(line)) break;
          if (line.trim()) descLines.push(line.trim());
        }
        if (descLines.length) data.description = descLines.join(' ').slice(0, 600);
      }
    }

    if (!data.parameters && paramsHeading.test(content)) {
      const lines = content.split(/\n/);
      const idx = lines.findIndex(l => paramsHeading.test(l));
      const params = [];
      let headerParsed = false;
      let headerMap = { name: 0, type: 1, description: 2, required: 3 };
      if (idx !== -1) {
        for (let i = idx + 1; i < lines.length; i++) {
          const line = lines[i];
          if (/^\s{0,3}#{1,6}\s+/.test(line)) break;
          if (!line.trim()) continue;
          if (line.trim().startsWith('|')) {
            const cells = line.split('|').slice(1, -1).map(s => s.trim());
            if (cells.length && cells[0].startsWith('---')) continue;
            if (!headerParsed && cells.some(c => /field|name/i.test(c))) {
              headerMap = {};
              cells.forEach((c, idxCell) => {
                const lc = c.toLowerCase();
                if (lc.includes('field') || lc.includes('name')) headerMap.name = idxCell;
                else if (lc.includes('type')) headerMap.type = idxCell;
                else if (lc.includes('description')) headerMap.description = idxCell;
                else if (lc.includes('required')) headerMap.required = idxCell;
              });
              headerParsed = true;
              continue;
            }
            if (cells.length) {
              const nameCell = cells[headerMap.name ?? 0] || '';
              const descCell = cells[headerMap.description ?? 2] || '';
              const typeCell = cells[headerMap.type ?? 1] || '';
              const reqCell = cells[headerMap.required ?? 3] || '';
              const name = nameCell.replace(/`/g, '').trim();
              const description = descCell.replace(/`/g, '').trim();
              const type = typeCell.replace(/`/g, '').trim();
              const required = /true|yes|required/i.test(reqCell);
              if (name) params.push({ name, description, type, required });
            }
            continue;
          }
          const m = line.match(/^[*-]\s*(\w[\w-]*)\s*[:|-]\s*(.+)$/);
          if (m) params.push({ name: m[1], description: m[2].trim() });
        }
      }
      if (params.length) data.parameters = params;
    }

    if (!data.parameters && data.syntax) {
      const bracket = data.syntax.match(/\[(.*)\]/s);
      if (bracket) {
        const parts = bracket[1].split(/\s*;\s*/).filter(Boolean);
        if (parts.length) {
          data.parameters = parts.map((p, i) => ({
            name: p.replace(/<|>|\{\}|\[\]/g, '').trim() || `param${i+1}`,
            description: null
          }));
        }
      }
    }

    if (!data.description) {
      const lines = content.split(/\n/);
      const idxFunc = lines.findIndex(l => l.includes(`$${funcName}`));
      if (idxFunc !== -1) {
        const funcLine = lines[idxFunc].replace(/`/g, '').trim();
        if (funcLine && !/\$[a-zA-Z][\w]*\s*\[/.test(funcLine)) {
          data.description = funcLine.slice(0, 600);
        } else {
          const descLines = [];
          for (let i = idxFunc + 1; i < lines.length; i++) {
            const line = lines[i];
            if (/^\s{0,3}#{1,6}\s+/.test(line)) break;
            if (!line.trim()) break;
            descLines.push(line.trim());
          }
          if (descLines.length && !data.description) {
            data.description = descLines.join(' ').slice(0, 600);
          }
        }
      }
    }

    const isExampleSection = String(c.section_title || '').match(/\bExample(s)?\b/i);
    if (isExampleSection) {
      const fences = [...content.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map(m => m[1].trim());
      for (const ex of fences) {
        if (data.examples.length >= 3) break;
        data.examples.push(ex);
      }
    }
  }

  data.sources = Array.from(new Set(data.sources));

  const needsParamDetails = !data.parameters || (Array.isArray(data.parameters) && data.parameters.every(p => !p.description));
  if (needsParamDetails) {
    const full = chunks.map(c => c.content || '').join('\n\n');
    const lines = full.split(/\n/);
    const idx = lines.findIndex(l => /^\s{0,3}#{1,6}\s+Parameters/i.test(l));
    if (idx !== -1) {
      const params = [];
      let headerParsed = false;
      let headerMap = { name: 0, type: 1, description: 2, required: 3 };
      for (let i = idx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s{0,3}#{1,6}\s+/.test(line)) break;
        if (!line.trim()) continue;
        if (line.trim().startsWith('|')) {
          const cells = line.split('|').slice(1, -1).map(s => s.trim());
          if (cells.length && /^-+$/.test(cells[0])) continue;
          if (!headerParsed && cells.some(c => /field|name/i.test(c))) {
            headerMap = {};
            cells.forEach((c, idxCell) => {
              const lc = c.toLowerCase();
              if (lc.includes('field') || lc.includes('name')) headerMap.name = idxCell;
              else if (lc.includes('type')) headerMap.type = idxCell;
              else if (lc.includes('description')) headerMap.description = idxCell;
              else if (lc.includes('required')) headerMap.required = idxCell;
            });
            headerParsed = true;
            continue;
          }
          if (cells.length) {
            const nameCell = cells[headerMap.name ?? 0] || '';
            const descCell = cells[headerMap.description ?? 2] || '';
            const typeCell = cells[headerMap.type ?? 1] || '';
            const reqCell = cells[headerMap.required ?? 3] || '';
            const name = nameCell.replace(/`/g, '').trim();
            const description = descCell.replace(/`/g, '').replace(/<br\s*\/?>/gi, ' ').trim();
            const type = typeCell.replace(/`/g, '').trim();
            const required = /true|yes|required/i.test(reqCell);
            if (name) params.push({ name, description, type, required });
          }
        }
      }
      if (params.length) data.parameters = params;
    }
  }

  if (!data.examples || data.examples.length === 0) {
    const full = chunks.map(c => c.content || '').join('\n\n');
    const sections = full.split(/\n(?=\s{0,3}#{1,6}\s+)/);
    for (const sec of sections) {
      const head = sec.split(/\n/, 1)[0] || '';
      if (!/^\s{0,3}#{1,6}\s+(Example|Examples)/i.test(head)) continue;
      const fences = [...sec.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map(m => m[1].trim());
      for (const ex of fences) {
        if (data.examples.length >= 3) break;
        data.examples.push(ex);
      }
      if (data.examples.length >= 1) break;
    }
    data.examples = Array.from(new Set(data.examples));
  }
  return data;
}

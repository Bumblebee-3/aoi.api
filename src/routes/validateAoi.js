import express from 'express';
import { sanitizeQuestion, safeMeta } from '../utils/sanitize.js';
import { generateAnswer } from '../services/llm.js';
import { searchByText, filterFunctionResults } from '../services/search.js';
import { relativeDocPath } from '../utils/parseDocs.js';
import { vectorStore } from '../services/vectorStore.js';

const router = express.Router();

function stripCodeFences(input) {
  if (typeof input !== 'string') return '';
  let s = input.trim();
  const fenceRegex = /```(?:aoi|javascript|js)?\s*([\s\S]*?)```/gi;
  s = s.replace(fenceRegex, '$1');
  return s.trim();
}

function extractFunctions(code) {
  const m = (code.match(/\$[A-Za-z0-9_]+/g) || []).map(x => x.trim());
  return Array.from(new Set(m));
}

function parseFunctionCalls(code) {
  const calls = new Map();
  const s = String(code || '');
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '$') continue;
    let j = i + 1;
    while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
    const name = s.slice(i, j);
    if (!name) continue;
    if (s[j] !== '[') {
      if (!calls.has(name)) calls.set(name, []);
      calls.get(name).push({ args: null, invalid: true });
      continue;
    }
    let k = j + 1, depth = 1;
    while (k < s.length && depth > 0) {
      if (s[k] === '[') depth++;
      else if (s[k] === ']') depth--;
      k++;
    }
    const inner = s.slice(j + 1, k - 1);
    const args = [];
    let buf = '';
    let d = 0;
    for (let t = 0; t < inner.length; t++) {
      const ch = inner[t];
      if (ch === '[') d++;
      else if (ch === ']') d = Math.max(0, d - 1);
      if (ch === ';' && d === 0) {
        args.push(buf);
        buf = '';
      } else {
        buf += ch;
      }
    }
    args.push(buf);
    if (!calls.has(name)) calls.set(name, []);
    calls.get(name).push({ args, invalid: false });
    i = k - 1;
  }
  return calls;
}

function validateFlow(code) {
  const errors = [];
  let depth = 0;
  const tokens = (code.match(/\$(if|elseif|else|endif)\b/gi) || []).map(x => x.toLowerCase());
  let elseCountAtDepth = {};
  for (const tok of tokens) {
    if (tok === '$if') { depth++; continue; }
    if (tok === '$elseif') { if (depth <= 0) errors.push('$elseif without matching $if'); continue; }
    if (tok === '$else') {
      if (depth <= 0) errors.push('$else without matching $if');
      else {
        elseCountAtDepth[depth] = (elseCountAtDepth[depth] || 0) + 1;
        if (elseCountAtDepth[depth] > 1) errors.push('Multiple $else at same $if depth');
      }
      continue;
    }
    if (tok === '$endif') { if (depth <= 0) errors.push('$endif without matching $if'); else { depth--; elseCountAtDepth[depth + 1] = 0; } }
  }
  if (depth !== 0) errors.push('Mismatched $if / $endif');
  return errors;
}

function validateOnlyIf(code) {
  const errors = [];
  const onlyIfs = code.match(/\$onlyIf\[[^\]]*\]/g) || [];
  for (const block of onlyIfs) {
    const inner = block.replace(/^\$onlyIf\[/, '').replace(/\]$/, '');
    const parts = inner.split(';');
    if (parts.length < 2 || !String(parts[1] || '').trim()) {
      errors.push('$onlyIf requires a non-empty error message');
    }
  }
  return errors;
}

function validateArithmeticInLogic(code) {
  const errors = [];
  const conds = [];
  const ifCalls = parseFunctionCalls(code).get('$if') || [];
  for (const c of ifCalls) if (Array.isArray(c.args) && c.args.length) conds.push(c.args[0]);
  const onlyIfCalls = parseFunctionCalls(code).get('$onlyIf') || [];
  for (const c of onlyIfCalls) if (Array.isArray(c.args) && c.args.length) conds.push(c.args[0]);
  for (const cond of conds) {
    if (/[+\-*/]/.test(String(cond))) {
      errors.push('Arithmetic operators are not allowed in logical conditions; use aoi.js comparison macros or documented patterns');
    }
  }
  return errors;
}

async function validateDocumentation(functions) {
  const documented = [];
  const undocumented = [];
  const threshold = Number(process.env.SIMILARITY_THRESHOLD || 0.60);
  for (const fn of functions) {
    if (['$if', '$elseif', '$else', '$endif'].includes(fn)) continue;
    const name = fn.replace(/^\$/,'').toLowerCase();
    try {
      const results = await searchByText(`$${name}`, { k: 40 });
      const filtered = filterFunctionResults(name, results).slice(0, 12);
      const topScore = filtered[0]?.score || 0;
      if (!filtered.length || topScore < threshold) {
        undocumented.push(fn);
      } else {
        documented.push(fn);
      }
    } catch {
      undocumented.push(fn);
    }
  }
  return { documentedFunctions: documented, undocumentedFunctions: undocumented };
}

function validateStructural(code) {
  const errors = [];
  const warnings = [];
  const functions = extractFunctions(code);
  const hasUsersWithRole = functions.includes('$usersWithRole');
  const hasMutations = functions.some(f => ['$setUserVar', '$setServerVar', '$setVar'].includes(f));
  if (hasUsersWithRole && hasMutations) {
    errors.push('Bulk-user operations are not supported: avoid combining $usersWithRole with mutations');
  }
  if (functions.includes('$for')) {
    errors.push('Loops are not supported in aoi.js: $for is invalid');
  }
  const getGlobal = functions.includes('$getVar') || functions.includes('$setVar');
  if (getGlobal) warnings.push('Global variables used without explicit justification');
  const hasOnlyIf = /\$onlyIf\[/g.test(code);
  const hasElse = /\$else\b/g.test(code);
  if (hasOnlyIf && hasElse) {
    warnings.push('$onlyIf should be used for validation, not branching');
  }
  return { errors, warnings };
}

router.get('/validateAoi', async (req, res) => {
  try {
    const { code, request } = req.query || {};
    const intent = sanitizeQuestion(request);
    let originalCode = typeof code === 'string' ? code : '';
    if (!originalCode) return res.status(400).json({ error: 'Missing required parameter "code"' });

    const normalizedCode = stripCodeFences(originalCode);
    if (!normalizedCode) return res.status(400).json({ error: 'Empty code after normalization' });

    const flowErrors = validateFlow(normalizedCode);
    const onlyIfErrors = validateOnlyIf(normalizedCode);
    const logicOpErrors = validateArithmeticInLogic(normalizedCode);

    const calls = parseFunctionCalls(normalizedCode);
    const invalidSyntax = [];
    for (const [name, invs] of calls.entries()) {
      for (const inv of invs) {
        if (inv.invalid) invalidSyntax.push(`Invalid function syntax: ${name} must use brackets [..]`);
      }
    }

    const functionsUsed = extractFunctions(normalizedCode);
    const { documentedFunctions, undocumentedFunctions } = await validateDocumentation(functionsUsed);

    const structural = validateStructural(normalizedCode);

    const errors = [
      ...flowErrors,
      ...onlyIfErrors,
      ...logicOpErrors,
      ...invalidSyntax,
      ...structural.errors,
      ...(undocumentedFunctions.length ? undocumentedFunctions.map(f => `Undocumented function: ${f}`) : [])
    ];
    const warnings = structural.warnings;

    const documentedRatio = functionsUsed.length ? documentedFunctions.length / functionsUsed.length : 0;
    const confidence = Number((0.5 + 0.5 * documentedRatio).toFixed(4));

    let fixedCode = null;
    const wantsFixEarly = /fix|correct|repair|resolve|update|rewrite|refactor/i.test(intent || '') || /^(fix|correct|repair|resolve|update|rewrite|refactor)$/i.test(String(req.query?.mode || req.query?.action || ''));

    if (wantsFixEarly) {
      const ifCount = (normalizedCode.match(/\$if\b/g) || []).length;
      const endifCount = (normalizedCode.match(/\$endif\b/g) || []).length;
      const delta = ifCount - endifCount;
      if (delta > 0) {
        const suffix = Array(delta).fill('$endif').join('\n');
        const repaired = normalizedCode + (normalizedCode.endsWith('\n') ? '' : '\n') + suffix + '\n';
        fixedCode = '```js\n' + repaired + '```';
      }
    }

    if (errors.length && intent && !fixedCode) {
      const topK = Number(process.env.TOP_K || 8);
      const intentResults = await searchByText(intent, { k: topK });
      const funcDocs = [];
      for (const fn of documentedFunctions) {
        const name = fn.replace(/^\$/,'');
        try {
          const res = await searchByText(`$${name}`, { k: 6 });
          funcDocs.push(...res);
        } catch {}
      }
      const allDocs = [...intentResults, ...funcDocs].slice(0, Number(process.env.CONTEXT_CHUNKS || 8)).map(r => ({
        file_path: r.file_path,
        section_title: safeMeta(r.section_title),
        content: r.content
      }));

      const explanatoryPrompt = [
        'Explain the following aoi.js code errors using ONLY the provided documentation context.',
        'If correction is requested, produce a corrected version within a single JavaScript code block.',
        'Do not invent undocumented functions. Maintain $if/$elseif/$else/$endif correctness and $onlyIf error messages.',
        '',
        'Request:',
        intent,
        '',
        'Original code:',
        originalCode,
        '',
        'Detected issues:',
        ...errors.map(e => `- ${e}`)
      ].join('\n');

      const gen = await generateAnswer({
        question: explanatoryPrompt,
        contextBlocks: allDocs,
        maxTokens: 800
      });
      const codeBlockMatch = gen.match(/```[aoi|javascript|js]*\n?([\s\S]*?)```/i) || gen.match(/```\n?([\s\S]*?)```/);
      const wantsFix = wantsFixEarly;
      if (codeBlockMatch && wantsFix) {
        fixedCode = codeBlockMatch[0];
      }
    }

    const valid = errors.length === 0;

    return res.json({
      request: intent || '',
      valid,
      errors,
      warnings,
      documentedFunctions,
      undocumentedFunctions,
      originalCode: normalizedCode,
      fixedCode,
      confidence
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;

export const meta = {
  path: '/api/validateAoi',
  method: 'GET',
  description: 'Validates aoi.js code for syntax, documentation, and logical correctness using local docs.',
  params: ['code (string): required aoi.js code', 'request (string): user intent for diagnostic/corrective context'],
  example: '/api/validateAoi?request=diagnose&code=%60%60%60js%5Cn$if[...]%5Cn%60%60%60'
};

export function register(app) {
  app.get('/api/validateAoi', async (req, res) => {
    try {
      req.query.request = req.query.request || req.query.intent || '';
      // Delegate to the main handler
      const fakeReq = { query: req.query };
      const fakeRes = { json: (obj) => res.json({ endpoint: meta.path, ...obj }), status: (c) => ({ json: (o) => res.status(c).json(o) }) };
      // Reuse logic by calling router stack function directly is complex; replicate core handler for register
      const { code, request } = req.query || {};
      const intent = sanitizeQuestion(request);
      let originalCode = typeof code === 'string' ? code : '';
      if (!originalCode) return res.status(400).json({ error: 'Missing required parameter "code"' });
      const normalizedCode = stripCodeFences(originalCode);
      if (!normalizedCode) return res.status(400).json({ error: 'Empty code after normalization' });
      const flowErrors = validateFlow(normalizedCode);
      const onlyIfErrors = validateOnlyIf(normalizedCode);
      const logicOpErrors = validateArithmeticInLogic(normalizedCode);
      const calls = parseFunctionCalls(normalizedCode);
      const invalidSyntax = [];
      for (const [name, invs] of calls.entries()) for (const inv of invs) if (inv.invalid) invalidSyntax.push(`Invalid function syntax: ${name} must use brackets [..]`);
      const functionsUsed = extractFunctions(normalizedCode);
      const { documentedFunctions, undocumentedFunctions } = await validateDocumentation(functionsUsed);
      const structural = validateStructural(normalizedCode);
      const errors = [ ...flowErrors, ...onlyIfErrors, ...logicOpErrors, ...invalidSyntax, ...structural.errors, ...(undocumentedFunctions.length ? undocumentedFunctions.map(f => `Undocumented function: ${f}`) : []) ];
      const warnings = structural.warnings;
      const documentedRatio = functionsUsed.length ? documentedFunctions.length / functionsUsed.length : 0;
      const confidence = Number((0.5 + 0.5 * documentedRatio).toFixed(4));
      let fixedCode = null;
      if (errors.length && intent) {
        const topK = Number(process.env.TOP_K || 8);
        const intentResults = await searchByText(intent, { k: topK });
        const funcDocs = [];
        for (const fn of documentedFunctions) { const name = fn.replace(/^\$/,''); try { const resDocs = await searchByText(`$${name}`, { k: 6 }); funcDocs.push(...resDocs); } catch {} }
        const allDocs = [...intentResults, ...funcDocs].slice(0, Number(process.env.CONTEXT_CHUNKS || 8)).map(r => ({ file_path: r.file_path, section_title: safeMeta(r.section_title), content: r.content }));
        const explanatoryPrompt = [ 'Explain the following aoi.js code errors using ONLY the provided documentation context.', 'If correction is requested, produce a corrected version within a single JavaScript code block.', 'Do not invent undocumented functions. Maintain $if/$elseif/$else/$endif correctness and $onlyIf error messages.', '', 'Request:', intent, '', 'Original code:', originalCode, '', 'Detected issues:', ...errors.map(e => `- ${e}`) ].join('\n');
        const gen = await generateAnswer({ question: explanatoryPrompt, contextBlocks: allDocs, maxTokens: 800 });
        const codeBlockMatch = gen.match(/```[aoi|javascript|js]*\n?([\s\S]*?)```/i) || gen.match(/```\n?([\s\S]*?)```/);
        const wantsFix = wantsFixEarly;
        if (codeBlockMatch && wantsFix) fixedCode = codeBlockMatch[0];
      }
      const valid = errors.length === 0;
      return res.json({ endpoint: meta.path, request: intent || '', valid, errors, warnings, documentedFunctions, undocumentedFunctions, originalCode: normalizedCode, fixedCode, confidence, meta: safeMeta({ functions: functionsUsed.length }) });
    } catch (err) {
      return res.status(500).json({ error: 'validateAoi failed', details: String(err?.message || err) });
    }
  });
}

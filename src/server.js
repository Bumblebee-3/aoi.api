import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import rateLimit from 'express-rate-limit';
import { sanitizeQuestion, safeMeta } from './utils/sanitize.js';
import { embedText } from './services/embedding.js';
import { vectorStore } from './services/vectorStore.js';
import { generateAnswer } from './services/llm.js';
import { searchByText, filterFunctionResults } from './services/search.js';
import { normalizeFuncName, extractFunctionMetadata, relativeDocPath } from './utils/parseDocs.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.get('/api', (req, res) => {
  const endpoints = [
    {
      path: '/api',
      method: 'GET',
      description: 'Lists all available endpoints, descriptions, and example usage.',
      example: '/api'
    },
    {
      path: '/api/basicQuery',
      method: 'GET',
      description: 'Answers aoi.js questions strictly from local docs using RAG.',
      params: [
        { name: 'request', required: true, description: 'Your aoi.js question.' },
        { name: 'style', required: false, description: 'Optional response style (e.g., simple).' }
      ],
      example: '/api/basicQuery?request=How%20to%20add%20a%20button%3F&style=simple'
    },
    {
      path: '/api/function',
      method: 'GET',
      description: 'Returns syntax, description, parameters, examples for a given aoi.js function.',
      params: [
        { name: 'name', required: true, description: 'Function name without the leading $ (e.g., addButton).' }
      ],
      example: '/api/function?name=addButton'
    }
  ];

  res.json({
    name: 'aoi.js RAG API',
    description: 'Doc-constrained API for aoi.js help, functions reference, and code generation.',
    endpoints
  });
});

app.get('/api/basicQuery', async (req, res) => {
  try {
    const { request, mode, style } = req.query || {};
    const q = sanitizeQuestion(request);
    if (!q) return res.status(400).json({ error: 'Invalid question' });

    const topK = Number(process.env.TOP_K || 8);
    const results = await searchByText(q, { k: topK });
    const threshold = Number(process.env.SIMILARITY_THRESHOLD || 0.60);
    const topScore = results[0]?.score || 0;

    const contextChunks = results.slice(0, Number(process.env.CONTEXT_CHUNKS || 6)).map(r => ({
      file_path: r.file_path,
      section_title: safeMeta(r.section_title),
      content: r.content
    }));
    const sources = Array.from(new Set(contextChunks.map(b => relativeDocPath(b.file_path))));

    if (!results.length || topScore < threshold) {
      return res.json({
        answer: 'This is not documented in the official aoi.js documentation.',
        code: null,
        sources: [],
        confidence: Number(topScore.toFixed(4))
      });
    }

    const isCode = String(mode || style || '').toLowerCase() === 'code';
    if (isCode) {
      const gen = await generateAnswer({
        question: `${q}\n\nGenerate minimal aoi.js code strictly using the provided context. Use correct bracket syntax [..] and separators ';' and ':'. Output only code in a single JavaScript code block.`,
        contextBlocks: contextChunks,
        maxTokens: 400
      });
      const codeBlockMatch = gen.match(/```[a-z]*\n([\s\S]*?)```/);
      const code = codeBlockMatch ? codeBlockMatch[0] : gen;
      return res.json({ code, sources, confidence: Number(topScore.toFixed(4)) });
    }

    const answer = await generateAnswer({
      question: `${q}\n\nAnswer strictly using the provided documentation context. If something is unknown or not in context, say it is not documented.`,
      contextBlocks: contextChunks,
      maxTokens: 350
    });
    return res.json({ answer, sources, confidence: Number(topScore.toFixed(4)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/function', async (req, res) => {
  try {
    const { name } = req.query || {};
    const raw = typeof name === 'string' ? name : '';
    const funcName = normalizeFuncName(raw);
    if (!funcName) return res.status(400).json({ error: 'Invalid function name' });

    const results = await searchByText(`$${funcName}`, { k: 50 });
    let filtered = filterFunctionResults(funcName, results).slice(0, 12);

    const threshold = Number(process.env.SIMILARITY_THRESHOLD || 0.60);
    const topScore = filtered[0]?.score || 0;

    if (!filtered.length || topScore < threshold) {
      return res.json({
        function: `$${funcName}`,
        syntax: null,
        description: null,
        parameters: null,
        examples: [],
        sources: [],
        confidence: Number(topScore.toFixed(4))
      });
    }

    let meta = extractFunctionMetadata(funcName, filtered);

    // Fallback: if parameters missing or descriptions empty, fetch more chunks from same file(s)
    const needsParamDetails = !meta.parameters || (Array.isArray(meta.parameters) && meta.parameters.every(p => !p.description));
    const uniqueFiles = Array.from(new Set(filtered.map(f => f.file_path).filter(Boolean)));
    if (needsParamDetails && uniqueFiles.length) {
      const extraChunks = [];
      for (const fp of uniqueFiles) {
        try {
          const rows = vectorStore.getByFilePath(fp, { limit: 50 });
          for (const r of rows) extraChunks.push(r);
        } catch {}
      }
      if (extraChunks.length) {
        // Merge and re-extract metadata
        const merged = [...filtered, ...extraChunks];
        meta = extractFunctionMetadata(funcName, merged);
      }
    }
    const confidence = Number(topScore.toFixed(4));
    return res.json({ ...meta, confidence });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});




const PORT = Number(process.env.PORT || 3333);
app.listen(PORT, () => {
  console.log(`RAG API listening on :${PORT}`);
});

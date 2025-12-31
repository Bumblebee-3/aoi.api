import express from 'express';
import { searchByText, filterFunctionResults } from '../services/search.js';
import { vectorStore } from '../services/vectorStore.js';
import { normalizeFuncName, extractFunctionMetadata } from '../utils/parseDocs.js';

const router = express.Router();

router.get('/function', async (req, res) => {
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

export default router;

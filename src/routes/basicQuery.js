import express from 'express';
import { sanitizeQuestion, safeMeta } from '../utils/sanitize.js';
import { generateAnswer } from '../services/llm.js';
import { searchByText } from '../services/search.js';
import { relativeDocPath } from '../utils/parseDocs.js';

const router = express.Router();

router.get('/basicQuery', async (req, res) => {
  try {
    const { q, request, max_tokens, mode, style } = req.query || {};
    const prompt = sanitizeQuestion(q || request);
    if (!prompt) return res.status(400).json({ error: 'Invalid question' });

    const topK = Number(process.env.TOP_K || 8);
    const results = await searchByText(prompt, { k: topK });
    const threshold = Number(process.env.SIMILARITY_THRESHOLD || 0.60);
    const topScore = results[0]?.score || 0;

    const contextChunks = results
      .slice(0, Number(process.env.CONTEXT_CHUNKS || 6))
      .map(r => ({
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
        question: `${prompt}\n\nGenerate minimal aoi.js code strictly using the provided context. Use correct bracket syntax [..] and separators ';' and ':'. Output only code in a single JavaScript code block.`,
        contextBlocks: contextChunks,
        maxTokens: Number(max_tokens || 400)
      });
      const codeBlockMatch = gen.match(/```[a-z]*\n([\s\S]*?)```/);
      const code = codeBlockMatch ? codeBlockMatch[0] : gen;
      return res.json({ code, sources, confidence: Number(topScore.toFixed(4)) });
    }

    const answer = await generateAnswer({
      question: `${prompt}\n\nAnswer strictly using the provided documentation context. If something is unknown or not in context, say it is not documented.`,
      contextBlocks: contextChunks,
      maxTokens: Number(max_tokens || 350)
    });
    return res.json({ answer, sources, confidence: Number(topScore.toFixed(4)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;
//import { sanitizeQuestion, safeMeta } from "../utils/sanitize.js";
//import { searchByText } from "../services/search.js";
//import { generateAnswer } from "../services/llm.js";
//import { relativeDocPath } from "../utils/parseDocs.js";

export const meta = {
  path: "/api/basicQuery",
  method: "GET",
  description: "Minimal Q&A strictly over local docs; returns a text answer with sources.",
  params: ["q (string): user question"],
  example: "/api/basicQuery?q=How%20to%20add%20a%20button%3F",
};

export function register(app) {
  app.get("/api/basicQuery", async (req, res) => {
    try {
      const q = sanitizeQuestion(req.query.q || req.query.question || "");
      if (!q) return res.status(400).json({ error: "Missing 'q' query parameter" });

      const results = await searchByText(q, Number(process.env.TOP_K || 6));
      const sources = results.map((r) => ({
        file: relativeDocPath(r.file_path),
        section: r.section_title,
        score: r.score,
      }));

      const contextBlocks = results.map((r) => r.content);
      const answer = await generateAnswer(q, contextBlocks, 512);

      return res.json({
        endpoint: meta.path,
        query: q,
        answer,
        sources,
        meta: safeMeta({ topK: results.length }),
      });
    } catch (err) {
      return res.status(500).json({ error: "basicQuery failed", details: String(err?.message || err) });
    }
  });
}

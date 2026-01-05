import express from 'express';
import { sanitizeQuestion, safeMeta } from '../utils/sanitize.js';
import { generateAnswer } from '../services/llm.js';
import { searchByText } from '../services/search.js';
import { relativeDocPath } from '../utils/parseDocs.js';

const router = express.Router();

router.get('/generateStrict', async (req, res) => {
  try {
    const { request, max_tokens } = req.query || {};
    const prompt = sanitizeQuestion(request);
    if (!prompt) {
      return res.status(400).json({ error: 'Invalid or missing "request" query parameter' });
    }

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
        error: 'Insufficient documentation context to generate strict aoi.js code',
        confidence: Number(topScore.toFixed(4)),
        sources: []
      });
    }

    const strictUserPrompt = [
  'You are an expert aoi.js code generator AND validator.',
  '',
  'CORE MODEL OF AOI.JS:',
  '1. aoi.js is NOT JavaScript.',
  '   - There are NO loops (for, while).',
  '   - There is NO recursion.',
  '   - Logic is built using $if, $elseif, $else, $endif.',
  '   - ❌ No inline math.',
  '   - ✅ Always use $sum[], $sub[], $multi[], $divide[].',
  '',
  '2. OUTPUT CONSTRAINTS (ABSOLUTE):',
  '   - Output MUST be a complete client.command({}) block (when possible).',
  '   - NEVER output raw function lines by themselves.',
  '   - NEVER use JavaScript template syntax (${...}).',
  '',
  '3. MESSAGE OUTPUT (CRITICAL):',
  '   - ALL output MUST be sent using $sendMessage[ ... ;false].',
  '   - DO NOT use $embed, $description, $title, $color functions.',
  '   - NOTHING may appear outside $sendMessage[ ].',
  '',
  '4. EMBED RULES (MANDATORY):',
  '   - Embeds MUST use inline {newEmbed:{...}} syntax.',
  '   - Embed fields MUST be separate { } blocks.',
  '   - ❌ NEVER separate embed fields with semicolons.',
  '',
  '   ✅ Correct embed format:',
  '   {newEmbed:',
  '     {title:Example}',
  '     {description:Text}',
  '     {color:GREEN}',
  '   }',
  '',
  '   ❌ INVALID embed format:',
  '   {newEmbed:{title:Example;description:Text};color:GREEN}',
  '',
  '5. FLOW CONTROL:',
  '   - Every $if MUST be closed with $endif.',
  '   - Ensure $if / $elseif / $else / $endif counts match.',
  '   - Nested $if depth should be minimal.',
  '   - DO NOT generate $onlyIf unless explicitly requested.',
  '   - Every $onlyIf MUST include an error message.',
  '',
  '6. VARIABLES:',
  '   - User variables: $getUserVar / $setUserVar.',
  '   - Server variables: $getServerVar / $setServerVar.',
  '   - Global variables ONLY if explicitly requested.',
  '   - NEVER invent variable scopes.',
  '',
  '7. DATA MODEL LIMITS:',
  '   - Economy systems are per-user.',
  '   - Bulk modification of many users is NOT supported.',
  '   - Commands operate on ONE user per execution.',
  '',
  '8. LISTS & COLLECTIONS:',
  '   - Functions like $usersWithRole return text lists.',
  '   - aoi.js has NO safe way to iterate over lists.',
  '   - DO NOT attempt iteration using $replaceText or nesting.',
  '',
  '9. DOCUMENTATION SAFETY:',
  '   - Use ONLY documented aoi.js functions provided in context.',
  '   - DO NOT invent functions or syntax.',
  '',
  '10. VALIDATION STEP (REQUIRED):',
  '   Before outputting final code, VERIFY:',
  '   - $sendMessage[ exists.',
  '   - ;false] is INSIDE $sendMessage.',
  '   - {newEmbed: is properly closed (if used).',
  '   - All [ ] and { } are balanced.',
  '   - No forbidden functions are used.',
  '',
  '   If ANY check fails → silently fix the code and re-output.',
  '',
  '11. REFUSAL RULE:',
  '   - If a request cannot be implemented cleanly in pure aoi.js:',
  '     Output ONLY:',
  '     $sendMessage[This is not documented in the official aoi.js documentation.;false]',
  '',
  'OUTPUT FORMAT:',
  '- Output ONLY a single ```javascript``` code block.',
  '- No explanations unless refusing.',
  '',
  'User request:',
  prompt,
  '',
  'Generate aoi.js code strictly using the provided documentation context.'
].join('\n');


    const gen = await generateAnswer({
      question: strictUserPrompt,
      contextBlocks: contextChunks,
      maxTokens: Number(max_tokens || 600)
    });

    const codeBlockMatch = gen.match(/```[a-z]*\n([\s\S]*?)```/);
    const code = codeBlockMatch ? codeBlockMatch[0] : gen;

    return res.json({
      code,
      sources,
      confidence: Number(topScore.toFixed(4))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;

export const meta = {
  path: '/api/generateStrict',
  method: 'GET',
  description: 'Strict aoi.js code generator from local docs only. Returns a single code block.',
  params: ['request (string): required user intent', 'max_tokens (number): optional token cap'],
  example: '/api/generateStrict?request=Economy%20daily%20command'
};

export function register(app) {
  app.get('/api/generateStrict', async (req, res) => {
    try {
      const { request, max_tokens } = req.query || {};
      const prompt = sanitizeQuestion(request);
      if (!prompt) return res.status(400).json({ error: 'Invalid or missing "request" query parameter' });

      const results = await searchByText(prompt, { k: Number(process.env.TOP_K || 8) });
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
          error: 'Insufficient documentation context to generate strict aoi.js code',
          confidence: Number(topScore.toFixed(4)),
          sources: []
        });
      }

      const strictUserPrompt = [
  'You are an expert aoi.js code generator AND validator.',
  '',
  'CORE MODEL OF AOI.JS:',
  '1. aoi.js is NOT JavaScript.',
  '   - There are NO loops (for, while).',
  '   - There is NO recursion.',
  '   - Logic is built using $if, $elseif, $else, $endif.',
  '   - ❌ No inline math.',
  '   - ✅ Always use $sum[], $sub[], $multi[], $divide[].',
  '',
  '2. OUTPUT CONSTRAINTS (ABSOLUTE):',
  '   - Output MUST be a complete client.command({}) block (when possible).',
  '   - NEVER output raw function lines by themselves.',
  '   - NEVER use JavaScript template syntax (${...}).',
  '',
  '3. MESSAGE OUTPUT (CRITICAL):',
  '   - ALL output MUST be sent using $sendMessage[ ... ;false].',
  '   - DO NOT use $embed, $description, $title, $color functions.',
  '   - NOTHING may appear outside $sendMessage[ ].',
  '',
  '4. EMBED RULES (MANDATORY):',
  '   - Embeds MUST use inline {newEmbed:{...}} syntax.',
  '   - Embed fields MUST be separate { } blocks.',
  '   - ❌ NEVER separate embed fields with semicolons.',
  '',
  '   ✅ Correct embed format:',
  '   {newEmbed:',
  '     {title:Example}',
  '     {description:Text}',
  '     {color:GREEN}',
  '   }',
  '',
  '   ❌ INVALID embed format:',
  '   {newEmbed:{title:Example;description:Text};color:GREEN}',
  '',
  '5. FLOW CONTROL:',
  '   - Every $if MUST be closed with $endif.',
  '   - Ensure $if / $elseif / $else / $endif counts match.',
  '   - Nested $if depth should be minimal.',
  '   - DO NOT generate $onlyIf unless explicitly requested.',
  '   - Every $onlyIf MUST include an error message.',
  '',
  '6. VARIABLES:',
  '   - User variables: $getUserVar / $setUserVar.',
  '   - Server variables: $getServerVar / $setServerVar.',
  '   - Global variables ONLY if explicitly requested.',
  '   - NEVER invent variable scopes.',
  '',
  '7. DATA MODEL LIMITS:',
  '   - Economy systems are per-user.',
  '   - Bulk modification of many users is NOT supported.',
  '   - Commands operate on ONE user per execution.',
  '',
  '8. LISTS & COLLECTIONS:',
  '   - Functions like $usersWithRole return text lists.',
  '   - aoi.js has NO safe way to iterate over lists.',
  '   - DO NOT attempt iteration using $replaceText or nesting.',
  '',
  '9. DOCUMENTATION SAFETY:',
  '   - Use ONLY documented aoi.js functions provided in context.',
  '   - DO NOT invent functions or syntax.',
  '',
  '10. VALIDATION STEP (REQUIRED):',
  '   Before outputting final code, VERIFY:',
  '   - $sendMessage[ exists.',
  '   - ;false] is INSIDE $sendMessage.',
  '   - {newEmbed: is properly closed (if used).',
  '   - All [ ] and { } are balanced.',
  '   - No forbidden functions are used.',
  '',
  '   If ANY check fails → silently fix the code and re-output.',
  '',
  '11. REFUSAL RULE:',
  '   - If a request cannot be implemented cleanly in pure aoi.js:',
  '     Output ONLY:',
  '     $sendMessage[This is not documented in the official aoi.js documentation.;false]',
  '',
  'OUTPUT FORMAT:',
  '- Output ONLY a single ```javascript``` code block.',
  '- No explanations unless refusing.',
  '',
  'User request:',
  prompt,
  '',
  'Generate aoi.js code strictly using the provided documentation context.'
].join('\n');


      const gen = await generateAnswer({
        question: strictUserPrompt,
        contextBlocks: contextChunks,
        maxTokens: Number(max_tokens || 600)
      });

      const codeBlockMatch = gen.match(/```[a-z]*\n([\s\S]*?)```/);
      const code = codeBlockMatch ? codeBlockMatch[0] : gen;

      return res.json({
        endpoint: meta.path,
        code,
        sources,
        confidence: Number(topScore.toFixed(4)),
        meta: safeMeta({ topK: results.length })
      });
    } catch (err) {
      return res.status(500).json({ error: 'generateStrict failed', details: String(err?.message || err) });
    }
  });
}

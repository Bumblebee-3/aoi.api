import express from 'express';

const router = express.Router();

router.get('/', (req, res) => {
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
        { name: 'q|request', required: true, description: 'Your aoi.js question.' },
        { name: 'mode|style', required: false, description: "Optional response mode; use 'code' to get code." },
        { name: 'max_tokens', required: false, description: 'Optional token budget for the answer/code.' }
      ],
      example: '/api/basicQuery?request=What+is+aoi.js'
    },
    {
      path: '/api/function',
      method: 'GET',
      description: 'Returns syntax, description, parameters, examples for a given aoi.js function.',
      params: [
        { name: 'name', required: true, description: 'Function name without the leading $ (e.g., addButton).' }
      ],
      example: '/api/function?name=addButton'
    },
    {
      path: '/api/generateStrict',
      method: 'GET',
      description: 'Strict aoi.js code generator using only local docs. Returns a single code block.',
      params: [
        { name: 'request', required: true, description: 'User intent to generate code for.' },
        { name: 'max_tokens', required: false, description: 'Optional token cap (default ~600).' }
      ],
      example: '/api/generateStrict?request=a%20leaderboard%20command%20for%global%20user%20variable%20%22cash%22%20made%20with%20embeds'
    },
    {
      path: '/api/validateAoi',
      method: 'GET',
      description: 'Validates aoi.js code (syntax, docs, logic). Optionally corrects missing $endif when requested.',
      params: [
        { name: 'code', required: true, description: 'aoi.js code to validate (supports fenced blocks).'},
        { name: 'request', required: false, description: 'User intent to guide explanation/fixes.' },
        { name: 'mode', required: false, description: "Optional corrective mode; use 'fix' to request a minimal fix." }
      ],
      example: '/api/validateAoi?request=diagnose&mode=fix&code=```$sendMessage[Bot%20ping%20:%20$pimg%20ms]```'
    }
  ];

  res.json({
    name: 'aoi.js RAG API',
    description: 'Doc-constrained API for aoi.js help, functions reference, and code generation.',
    endpoints
  });
});

export default router;

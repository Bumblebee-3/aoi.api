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
      example: '/api/basicQuery?request=What+is+aoi.js&style=code'
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

export default router;

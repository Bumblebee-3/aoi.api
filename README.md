# aoi.js Support Assistant API

Doc-constrained Node.js API that answers aoi.js questions and can generate minimal code from local docs.

## Requirements
- Node.js >= 18.18
- Local docs at `website/` (read-only)
- `GEMINI_API_KEY` (embeddings)
- `MISTRAL_API_KEY` (generation)

## Setup

```zsh
cd aoi.api
cp .env.example .env
# set DOCS_PATH, GEMINI_API_KEY, MISTRAL_API_KEY
npm install
```

## Ingest Documentation (one-time)

```zsh
npm run ingest
```

Reads Markdown/MDX under `DOCS_PATH`, chunks content, embeds with Gemini, and stores vectors in SQLite at `data/vectors.db`.

## Start API

```zsh
# Default port is 3333 (set PORT to override)
npm run dev
```

## Endpoints

`GET /api` — Index of endpoints
```zsh
curl -sS http://localhost:${PORT:-3333}/api | jq
```

`GET /api/query` — Answer questions from docs, or generate minimal code
- Query params:
  - `request` (required): your aoi.js question
  - `mode` (optional): set to `code` to generate minimal code
```zsh
# Answer mode
curl -sS 'http://localhost:${PORT:-3333}/api/query?request=How%20to%20add%20a%20button%3F' | jq

# Code mode
curl -sS 'http://localhost:${PORT:-3333}/api/query?request=Create%20a%20simple%20coin%20balance%20command&mode=code' | jq
```

`GET /api/function` — Function reference from docs
- Query params:
  - `name` (required): function name without `$` (e.g., `addButton`)
```zsh
curl -sS 'http://localhost:${PORT:-3333}/api/function?name=addButton' | jq
```

`GET /api/generateStrict` — Strict aoi.js code generator from local docs only
- Query params:
  - `request` (required): user intent (e.g., "economy daily command")
  - `max_tokens` (optional): cap for generation
```zsh
curl -sS 'http://localhost:${PORT:-3333}/api/generateStrict?request=Economy%20daily%20command' | jq
```

`GET /api/validateAoi` — Validate aoi.js code (syntax, docs compliance, logic)
- Query params:
  - `code` (required): aoi.js code (fences allowed)
  - `request` (required): intent (e.g., "diagnose" or "fix my code")
  - `mode` (optional): set to `fix` to request a deterministic simple repair when possible
```zsh
curl -sS 'http://localhost:${PORT:-3333}/api/validateAoi' \
  --get \
  --data-urlencode 'request=diagnose my command' \
  --data-urlencode 'code=```js\n$if[$getUserVar[balance]>=100]\n$setUserVar[balance;$math[$getUserVar[balance]-100];$authorID]\n$else\n$sendMessage[Not enough balance;no]\n$endif\n```' | jq

# Request deterministic repair (adds missing $endif if needed)
curl -sS 'http://localhost:${PORT:-3333}/api/validateAoi' \
  --get \
  --data-urlencode 'request=fix my flow' \
  --data-urlencode 'mode=fix' \
  --data-urlencode 'code=```aoi$if[$message==hi]$sendMessage[Hello;false]```' | jq
```

## Environment
- `DOCS_PATH`: root of local docs (default `../website/src/content/docs` if set in ingest script)
- `PORT`: server port (default `3333`)
- `RATE_WINDOW_MS`, `RATE_MAX`: rate limiting window and max
- `TOP_K`, `CONTEXT_CHUNKS`, `SIMILARITY_THRESHOLD`: retrieval tuning
- `GEMINI_API_KEY`: Google Generative AI key for embeddings
- `MISTRAL_API_KEY`: Mistral API key for generation
- `GENERATE_RATE_WINDOW_MS`, `GENERATE_RATE_MAX`: per-route limiter for generation endpoints

## Notes
- Strictly uses local docs; no external doc fetching.
- Gemini for embeddings; Mistral for answers/code.
- Rate-limited and sanitized.
- Context-limited RAG; the LLM only sees relevant chunks.
- Strict generator `/api/generateStrict` outputs a single code block only.
- Validator `/api/validateAoi` runs deterministic checks before optional LLM reasoning.

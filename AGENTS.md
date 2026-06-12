# Voluki Website Notes

## Project Overview

- This is a personal website/blog built with Astro.
- Main app framework: Astro 4.
- Content posts live in `src/content/blog`.
- Shared page shell lives in `src/layouts/BaseLayout.astro`.
- Global styles live in `public/styles/global.css`.
- Static assets go in `public/` and are referenced from pages with root paths such as `/index-img.png`.
- The home page is `src/pages/index.astro`.
- The IELTS writing practice page is `src/pages/ielts-writing.astro` and is available at `/ielts-writing/`.

## Commands

Use the existing npm scripts:

```bash
npm install
npm run dev
npm run build
npm run preview
```

The scripts are intentionally cross-platform. Do not use Unix-only inline environment variable syntax such as `ASTRO_TELEMETRY_DISABLED=1 astro dev` in `package.json`, because the user works on Windows PowerShell too.

## Deployment

- The project is configured for Cloudflare Pages with `@astrojs/cloudflare`.
- `astro.config.mjs` uses `output: "hybrid"` so normal pages can be static while API routes run dynamically.
- The Cloudflare adapter uses `imageService: "passthrough"` to avoid Sharp incompatibility warnings.
- Cloudflare Pages build settings:
  - Build command: `npm run build`
  - Output directory: `dist`
- On Windows, the Cloudflare adapter may need optional dependencies installed:

```bash
npm install --include=optional
```

If the local build logs end with `[build] Complete!` and then shows a Windows `workerd` assertion on exit, the build itself likely completed; verify Cloudflare's Linux build separately.

## Environment Variables

Do not commit `.env`; it is ignored by `.gitignore`.

Required runtime variables for the AI writing page:

```env
DEEPSEEK_API_KEY=your_deepseek_api_key_here
OPENAI_MODEL=deepseek-v4-pro
AI_BASE_URL=https://api.deepseek.com
```

Cloudflare Pages variables must be configured in the Pages project settings under environment variables/secrets. `DEEPSEEK_API_KEY` should be a secret. Variables must be configured for Production, and also Preview if preview deployments should support AI calls. Redeploy after changing Cloudflare variables.

Server code reads variables through `src/lib/env.ts`, which supports both local `import.meta.env` and Cloudflare runtime env via `locals.runtime.env`.

## AI Writing Practice

The page `src/pages/ielts-writing.astro` implements "SRT Console" (Sentence Reverse Translation Console):

1. User pastes an English passage.
2. Frontend calls `/api/ielts/split`.
3. The split API asks the model to return sentence-level JSON:
   - `sequence`
   - `english_text`
   - `chinese_text`
   - `structure`
4. The UI shows only the Chinese sentence for practice. The `structure` field is kept in data for future analysis but is not displayed.
5. User translates each Chinese sentence back into English.
6. Frontend calls `/api/ielts/analyze`.
7. The analysis API returns an `analyses` array with score, 6.5-7.0 rewrite, grammar analysis, expression comparison, logic/structure notes, chunks, sentence patterns, rewrites, and learning focus.

The AI provider is DeepSeek-compatible Chat Completions:

- Base URL default: `https://api.deepseek.com`
- Endpoint: `/chat/completions`
- JSON mode: `response_format: { type: "json_object" }`

Keep the API key server-side only. Never expose it in client JavaScript.

## Markdown Rendering

- `markdown-it` is used on the client side to render analysis sections.
- Raw HTML rendering is disabled with `html: false`.
- The page currently builds Markdown from structured JSON for all analysis sections.
- `grammar_markdown` is preferred for the grammar section when the model returns it; otherwise the UI generates Markdown from `grammar_errors`.

## API Routes And Helpers

- `src/pages/api/ielts/split.ts`
  - Splits the input passage into practice sentences and Chinese translations.
- `src/pages/api/ielts/analyze.ts`
  - Analyzes each user translation.
- `src/lib/readJsonBody.ts`
  - Reads request bodies safely and returns useful JSON errors instead of throwing raw Astro stack traces.
- `src/lib/env.ts`
  - Reads environment variables from Cloudflare runtime env first, then local build env.

## Content Model

Blog posts use Astro content collections. Schema is defined in `src/content/config.ts`.

Blog frontmatter supports:

- `title`
- `description`
- `date`
- `updated`
- `tags`
- `category`
- `image`
- `imageAlt`
- `draft`

Add posts under `src/content/blog`.

## UI Notes

- The site uses a restrained minimal style with CSS variables in `public/styles/global.css`.
- Cards use small radii and quiet borders.
- The SRT Console has scoped styles plus a `style is:global` block because many sentence cards and analysis blocks are generated dynamically with client-side JavaScript. Dynamic HTML will not receive Astro scoped style attributes, so keep dynamic component styles global under `.writing-lab`.
- The home hero image currently uses `/index-img.png` from `public/index-img.png`.

## Git And Safety

- Do not commit `.env` or API keys.
- If a key is accidentally pasted into chat, advise rotating/revoking it.
- Before committing, include `package-lock.json` whenever dependencies change.
- Current deployment target is the `main` branch on GitHub and Cloudflare Pages.

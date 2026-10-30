# DataDarshanam

**Turn business questions into clear, evidence-backed answers and visualizations.**

DataDarshanam is a conversational analytics workspace for exploring demo data, uploading CSV datasets, and asking questions in natural language. It combines deterministic analytics, interactive charts, document workflows, and AI-assisted explanations in one Ledger-style interface.

## Capabilities

- Query datasets with natural language.
- Generate KPIs, tables, comparisons, and interactive Plotly charts.
- Upload private CSV datasets and access saved datasets securely.
- Switch chart types, save charts, and export query results.
- Explore documents and ask grounded questions about uploaded content.
- Preserve query history and continue with follow-up questions.
- Use the built-in demo dataset without authentication.

## Preview

<p>
  <img src="frontend/public/brand/lockup-ink.svg" alt="DataDarshanam" width="240">
</p>

## Technology

- Next.js App Router, React, and TypeScript
- Plotly.js and Tailwind CSS
- Supabase Auth, Postgres, Storage, and row-level security
- Groq and Gemini provider integrations
- Vitest for unit and integration tests

## Getting started

Requirements:

- Node.js 20 or newer
- npm
- Optional: a Supabase project for authentication and custom datasets

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Configuration

Create `frontend/.env.local` and set only the variables required by the features you use:

- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - browser-safe Supabase anon/publishable key.
- `SUPABASE_SERVICE_ROLE_KEY` - server-only Supabase key.
- `GROQ_API_KEY` - server-only Groq API key.
- `GROQ_MODEL` - optional Groq model name.
- `GEMINI_API_KEY` - optional server-only Gemini API key.
- `GEMINI_EMBEDDING_MODEL`, `GEMINI_EMBEDDING_DIMENSION`, and related embedding variables - optional document embedding configuration.
- `DOCUMENT_RAG_ANSWERS_ENABLED` - document-answer feature flag.

Never commit real credentials. The anon/publishable key is public, but the service-role and provider keys must remain server-only.

## Development commands

Run all checks from `frontend/`:

```powershell
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Database migrations are stored in `supabase/migrations/`. Review the migration list and intended environment before applying any migration.

## Repository layout

- `frontend/` - Next.js application and API routes.
- `backend/` - optional legacy Python service.
- `supabase/` - local Supabase configuration and migrations.
- `data/` - demo dataset source and SQLite database used by the legacy backend.
- `scripts/` - demo dataset preparation utility.

## License

No license file is currently included. All rights reserved unless a license is added.

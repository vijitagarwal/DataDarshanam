# DataDarshanam frontend

The Next.js App Router application uses same-origin route handlers under `src/app/api`. The older FastAPI backend is a separate legacy service and is not required by this frontend.

## Local setup

Install dependencies and start the application:

```powershell
npm install
npm run dev
```

Create `frontend/.env.local` if it does not exist. If the file already exists, preserve it and merge only the necessary names from [`.env.example`](./.env.example). Never copy secret values into source control.

| Variable | Required for | Where to obtain it | Local file | Vercel |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Auth and saved datasets | Supabase project settings → API | `.env.local` | Preview settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser Auth; safe only with RLS | Supabase project settings → API keys | `.env.local` | Preview settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Private dataset metadata and Storage operations | Supabase project settings → API keys | `.env.local` | Preview settings; server-only |
| `GROQ_API_KEY` | Optional query parsing, insights, and document answers | Groq console | `.env.local` | Preview settings; server-only |
| `GEMINI_API_KEY` | Optional document embeddings | Google AI Studio | `.env.local` | Preview settings; server-only |

`GROQ_MODEL` and the `GEMINI_EMBEDDING_*` values are optional server-side configuration; defaults are listed in `.env.example`. `DOCUMENT_RAG_ANSWERS_ENABLED` must remain `false` until the document answer integration is independently verified. Do not create guessed credentials or replace an existing `.env.local`.

The sign-in screen accepts existing accounts only. It does not expose public sign-up or password reset. Configure the localhost and intended Vercel Preview redirect URLs in the staging Supabase Auth settings and provision a test account from the staging dashboard.

## Dataset storage

Custom CSV routes require a valid Supabase access token. The API verifies that token with Supabase Auth, generates the dataset UUID and object path, reserves account quota transactionally, uploads the file to the private `datasets` bucket, and marks owner-scoped metadata ready only after the object upload succeeds.

`public.datasets` has RLS enabled. Authenticated users can read their own metadata; client-side writes are not granted. Server routes use the service-role client only after user verification and filter every dataset query by the verified `user_id`. Storage objects are kept under `<user-uuid>/<dataset-uuid>.csv`; authenticated direct reads are limited to the caller's UUID prefix. Server-side application writes and deletes use the private bucket.

Limits are 25 MiB per file, 250,000 data rows, 100 columns, 1,000,000 cells, 10 active datasets per account, and 200 MiB total per account. CSV input is strict UTF-8, supports quoted commas and newlines, and rejects duplicate/empty headers, malformed quoting, and inconsistent row widths. The browser stores only the selected dataset ID and display name, not the file.

The migration `supabase/migrations/20261027120000_mission10_owned_datasets.sql` is additive and has not been applied. Do not run `supabase db push` until the linked project has been independently confirmed as non-production staging and its migration list reviewed. No live Supabase or Vercel configuration is changed by local development.

If a request is interrupted while its reservation is still uploading or deleting, the row is shown in the saved-dataset list with a delete/retry action so the owner can remove the reservation and corresponding object. Cleanup is not automatically scheduled. Account deletion also requires explicit Storage cleanup because the metadata foreign-key cascade cannot remove a Storage object.

## Tests and checks

Run the deterministic suite with `npm test`. The tests mock provider and Supabase boundaries and require no real credentials. See [`TESTING.md`](./TESTING.md) for coverage boundaries and the staging verification checklist.

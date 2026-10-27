# DataDarshanam Mission 7C.1 — Post-Implementation Audit

## Scope and summary

This audit reviewed the Mission 7C completion report, embedding persistence service and route, embedding identity/normalization code, Mission 6 extraction migration, Mission 7C persistence migration, relevant tests, and current repository status. Existing worktree changes and untracked reports were preserved. No other project was modified. No migration was applied and no deployment or live provider/database check was performed.

The reported standalone TypeScript failures were limited to test typing. They are fixed without weakening TypeScript or changing the production `/api/query` contract. The audit also fixed a job-status reporting defect: if the best-effort failure RPC does not confirm a persisted state transition, the service now reports `processing` rather than a potentially false terminal `failed`.

## Findings

| # | Severity | Finding and evidence | Status |
|---|---|---|---|
| 1 | MEDIUM | When provider/persistence work failed, `processDocumentEmbeddings` ignored the failure RPC result and returned `failed` even if the database row remained `processing` under its active lease. A subsequent request could then receive `processing` despite the prior caller reporting a terminal failure. | **Fixed.** The service returns `processing` unless the failure RPC confirms `true`; a deterministic test simulates an RPC error. |
| 2 | LOW | `npx tsc --noEmit` failures were test-helper type mismatches: the query route tests passed `Request` to a handler declared with `NextRequest`, and the ingestion test cast its mock client to `never`, making `rpc` unavailable on the inferred type. | **Fixed.** Query tests now construct `NextRequest`; ingestion tests cast the partial mock through `unknown` to the actual `SupabaseClient` interface. |
| 3 | MEDIUM, conditional/unverified | The SECURITY DEFINER functions pin `search_path`, but it includes `public` before `extensions`, and the Mission 7C RPCs call `digest(...)` without schema qualification. Whether this permits function shadowing depends on the target database's `CREATE` privileges on `public` and the installed pgcrypto function schema. Neither was available for live verification. All table references in these RPCs are schema-qualified; function execution is revoked from `PUBLIC`, `anon`, and `authenticated` and granted to `service_role`. | **Not confirmed exploitable.** Verify effective schema privileges and pgcrypto namespace on non-production Supabase before applying. If `public` is writable by untrusted roles or `digest` resolves there, harden the migration's function resolution before deployment. |
| 4 | LOW / operational | Processing is synchronous and may perform many token-count and embedding calls. The route has no explicit platform `maxDuration`; current application bounds do not prove largest accepted jobs will fit the deployed Vercel runtime. | **Unverified runtime risk.** Measure with a non-production deployment and choose a worker boundary/runtime limit before enabling large jobs. |

No confirmed cross-user access path or direct authenticated write path was found in the reviewed application/migration. This conclusion is source review only, not proof of effective Supabase privileges or RLS behavior.

## Database and security review

- **Ownership consistency:** the migration adds composite unique keys and composite foreign keys tying jobs to `(document_id,user_id)`, manifest parts to a job and to `(source_chunk_id,document_id,user_id)`, and embeddings to both their owner/document and source chunk. The Mission 6 owner-matching triggers remain in place.
- **Client access:** RLS is enabled on all three new tables. The policy permits authenticated users to select their own job rows only; the migration revokes table privileges from `anon` and `authenticated`, then grants authenticated `SELECT` on jobs. It grants no authenticated write access to jobs, manifests, or embeddings.
- **RPC access:** the claim, persist, finish, and fail functions are `SECURITY DEFINER`, pin a `search_path`, and have execute revoked from `PUBLIC`, `anon`, and `authenticated`; execution is granted to `service_role`. RPCs check owner/document status, source chunk membership, job claim, manifest attributes, and readiness/completeness. Most table names are schema-qualified.
- **Caller-controlled ownership:** the route derives the user ID from verified bearer-token authentication and takes only the document ID from the URL. The service scopes initial document/chunk/embedding reads by both document and verified owner. RPC arguments include owner IDs, but the RPCs re-check document and chunk ownership. Direct calls by ordinary authenticated clients are intended to be denied by function grants.
- **Transactions and concurrency:** each RPC executes as a PostgreSQL transaction. Claiming locks the ready document and job row; active claims have a UUID and 30-minute lease. Batch writes and finish require the active claim; finish also requires a complete manifest-to-embedding join. Unique keys prevent duplicate source-part-space rows. A reclaimed job receives a different claim ID, preventing the previous worker from finishing it. Failure transitions now require a positive RPC result before the application reports terminal failure.
- **Partial persistence and retry:** successful batches remain persisted if a later batch fails. A retry verifies and reuses matching existing vectors and persists only missing parts. Conflicting metadata is rejected rather than overwritten. These properties are supported by unit tests and SQL review, but transaction isolation/concurrency require live PostgreSQL testing.
- **Error/data exposure:** public route responses use safe status/error codes; provider/database details and document text are not returned or logged by the embedding service. Embedding rows intentionally retain derived input text as well as hashes/vectors, so project backup, retention, and privileged operational access remain sensitive.
- **Cross-migration behavior:** Mission 6 extraction persistence deletes/replaces chunks transactionally; Mission 7C composite foreign keys cascade old embeddings and manifest parts when chunks are replaced. The per-document job row itself is not chunk-dependent. Normal document lifecycle does not permit a ready document to re-enter extraction, but any future reprocessing/reset path must also define how an existing embedding job is versioned or invalidated.

## Embedding correctness review

- `normalizeEmbeddingValues` validates dimension and finite numeric values, rejects all-zero vectors, computes the Euclidean norm, divides each component by that norm, and verifies the normalized result. Both document and query paths use this helper.
- The identity includes model, dimension, `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` task configuration, `l2-unit-v1`, provider, and version. The persistence service additionally restricts the current persistence path to the configured default model and 768 dimensions.
- Existing persisted vectors are checked for expected dimension, finite values, and unit norm before reuse. Newly returned vectors are checked for identity, source/part mapping, dimensions, finite values, and unit norm before the persistence RPC.
- The SQL persist RPC casts to `vector(768)` and checks squared L2 norm within tolerance. The SQL check is a second defense; it does not prove Gemini response behavior.
- Input hashes bind the exact formatted provider input; source hashes bind the stored chunk. JavaScript validates source slices and UTF-16 offsets before manifest submission. SQL checks source ownership, stored hashes, and offset bounds but cannot reproduce JavaScript UTF-16 slice semantics.
- No extraction/chunking implementation or canonical Mission 6 chunk content/offset was changed by this audit.

## TypeScript diagnostics and resolutions

Before fixes, `npx tsc --noEmit` exited 2 with:

- `src/app/api/query/route.test.ts` at lines 75, 99, 108, 109, 110, 122, 137, 160, and 173: `TS2345`, `Request` is not assignable to `NextRequest` because `cookies`, `nextUrl`, `page`, and `ua` are absent.
- `src/lib/ingestion/ingestionService.test.ts` at lines 48, 78, and 88: `TS2339`, property `rpc` does not exist on type `never`.

The route tests now construct `NextRequest` instances matching the handler signature. The ingestion test mock is asserted as `SupabaseClient` through `unknown`, matching the mock boundary and exposing its `rpc` method to the tests. No production query handler behavior, compiler options, exclusions, or broad `any` types were changed.

## Files changed for Mission 7C.1

- `frontend/src/app/api/query/route.test.ts` — align test request type with the real Next.js route handler.
- `frontend/src/lib/ingestion/ingestionService.test.ts` — correct the mock client's Supabase type so `rpc` assertions compile.
- `frontend/src/lib/embeddings/embeddingService.ts` — do not report a terminal failure when the failure-state RPC is unsuccessful or does not confirm the state transition.
- `frontend/src/lib/embeddings/embeddingService.test.ts` — cover the failure-state RPC error path.
- `DATADARSHANAM_MISSION_7C_1_AUDIT.md` — this audit.

The worktree had substantial pre-existing Mission 0–7C changes and untracked reports. They were not reverted or otherwise cleaned up.

## Verification results

Commands were run after the fixes:

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **PASS**, exit 0, no diagnostics. |
| `npm test` | **PASS**, 21 test files, 92 tests. Vite emitted its existing CJS Node API deprecation notice. |
| `npm run lint` | **PASS**, exit 0, 0 errors and 2 warnings in `src/components/ChartView.tsx` for `plotData` and `plotLayout` Hook dependencies. No new lint warnings were introduced by this work. |
| `npm run build` | **PASS**, exit 0; production build and Next.js TypeScript validation completed, with 10 static pages generated. |
| `git diff --check` | **PASS**, exit 0; Git printed line-ending conversion warnings for changed frontend files, not whitespace errors. |

## Confirmed fixes and unverified assumptions

**Confirmed locally:** type errors are resolved; the failure-RPC status mismatch is covered by a deterministic mock test; vector normalization and validation paths are exercised by provider/service tests; the build, lint, test suite, typecheck, and whitespace check pass.

**Not verified live:** SQL syntax/behavior against the configured PostgreSQL version; migration compatibility with the actual Mission 4/6 schema; effective `SECURITY DEFINER` owner and `search_path`; `public` and `extensions` schema `CREATE` privileges; pgcrypto/digest namespace; effective Supabase role grants/RLS; race behavior under concurrent requests; pgvector extension schema/dimension support; Gemini model access/quota; and Vercel request duration/memory behavior. Mocks and static SQL inspection are not substitutes for these checks.

## Remaining blockers before Mission 8

1. Apply the migration only in an explicitly authorized non-production Supabase project and verify effective grants, RLS, function definitions/search paths, pgcrypto namespace, foreign keys, and vector type.
2. Resolve or document the conditional `digest` name-resolution risk based on actual target-project `CREATE` grants and extension schema. Do not infer safety from the migration text alone.
3. Execute two-user ownership, direct RPC denial, duplicate/concurrent claims, stale-claim rejection, interrupted batch/retry, and cascade-cleanup tests against non-production PostgreSQL/Supabase.
4. Run one minimal non-sensitive Gemini document/query check with authorized credentials; verify matching model/dimension/task configuration and normalized vectors. Provider access remains unverified.
5. Verify the largest supported processing job against the intended Vercel runtime, or introduce a bounded worker before relying on synchronous requests for large jobs.
6. Before implementing retrieval, agree on how queries obtain and enforce the same embedding-space identity as persisted document vectors. Any model/dimension/normalization/version change must use a distinct embedding space and migration plan.

No production access or migration was needed to complete this code/test hardening. Do not deploy Mission 7C until its non-production database and provider checks pass.

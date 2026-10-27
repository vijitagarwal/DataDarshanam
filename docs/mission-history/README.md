# DataDarshanam implementation history

This index preserves implementation evidence and operational caveats without duplicating the full reports. Reports remain at the repository root to avoid breaking their existing relative links.

## Document workflow and RAG

1. [Mission 5.1 Supabase integration checklist](../../SUPABASE_MISSION_5_1_CHECKLIST.md) — non-production authentication, ownership, Storage, deletion, and RLS verification steps; live checks remain unverified.
2. [Mission 7A provider verification](../../DATADARSHANAM_MISSION_7A_PROVIDER_VERIFICATION.md) — historical Gemini model/dimension decision before implementation.
3. [Mission 7C embedding persistence](../../DATADARSHANAM_MISSION_7C_COMPLETION.md) — persistence design, idempotency, mocked test results, migration, and live-verification blockers.
4. [Mission 7C.1 post-implementation audit](../../DATADARSHANAM_MISSION_7C_1_AUDIT.md) — correctness fixes and conditional migration/runtime risks. The later Mission 8 migration reports hardening work, but live database verification is still required.
5. [Mission 8 secure retrieval](../../DATADARSHANAM_MISSION_8_COMPLETION.md) — authenticated retrieval contract, owner-scoped RPC, ranking behavior, migration notes, and unverified live checks.
6. [Mission 9 grounded answers](../../DATADARSHANAM_MISSION_9_COMPLETION.md) — `/api/answers`, citation validation, abstention, and the server-only feature flag that remains disabled by default.
7. [Mission 10 frontend integration](../../DATADARSHANAM_MISSION_10_COMPLETION.md) — document workspace/Q&A behavior, API validation, tests, and UI limitations.

## Historical design and baseline reviews

- [Persistent RAG implementation plan](../../DATADARSHANAM_RAG_IMPLEMENTATION_PLAN.md) — planning document; implementation status described there is historical and superseded by Missions 4–10.
- [Capstone audit](../../DATADARSHANAM_CAPSTONE_AUDIT.md) — pre-RAG baseline assessment; its “RAG missing” conclusion predates the subsequent missions.

## Important outstanding verification

- No live Supabase migration, RLS/Storage policy, RPC-grant, pgvector, or cross-user isolation verification is recorded.
- Gemini embedding behavior, Groq grounded-answer behavior, and Vercel runtime/feature-flag behavior remain unverified live.
- Keep `DOCUMENT_RAG_ANSWERS_ENABLED=false` until the required non-production checks and evaluation are complete.
- The available history contains no separate Mission 7B or Mission 7B.1 completion report. Their mocked provider/token-budget behavior is summarized in [`frontend/TESTING.md`](../../frontend/TESTING.md).

# DataDarshanam Mission 10 — Frontend RAG Integration

## Outcome

Added a document question-and-answer panel to the existing analytics workspace. The panel reuses the existing private document manager and document-list API, and calls the existing authenticated `POST /api/answers` endpoint through a new browser API helper. The Q&A UI is not a replacement for the CSV workflow.

The answer endpoint remains guarded by the server-only `DOCUMENT_RAG_ANSWERS_ENABLED` feature flag. The example configuration continues to set it to `false`; this mission did not enable the flag in any runtime environment or deployment.

## Pages and components changed

- `frontend/src/app/page.tsx`
  - Adds a shared document-list state and places the document manager and Q&A panel in the existing scrollable workspace, ahead of the existing CSV analytics conversation.
- `frontend/src/components/DocumentManager.tsx`
  - Adds optional callbacks to share the existing loaded document list/loading/error state with Q&A.
  - Clears shared documents when the signed-in user changes so a prior user's list is not retained in the shared Q&A view.
  - Does not add or imply a manual retry action.
- `frontend/src/components/DocumentQaPanel.tsx`
  - Adds document selection, question input, pending and duplicate-submission protection, answer/abstention/no-evidence states, feature-disabled feedback, and server-returned source metadata.
  - Only documents with the existing API's `ready` status are selectable. Other statuses are visible but disabled.
- `frontend/src/lib/documentQaApi.ts`
  - Uses the current Supabase browser session's access token to call `/api/answers`, handles session expiry and the feature-disabled response, and validates the server response before UI rendering.
- `frontend/src/lib/documentQaState.ts`
  - Holds small tested helpers for ready-document scoping, selection toggling, and pending-submit locking.
- Tests:
  - `frontend/src/lib/documentQaApi.test.ts`
  - `frontend/src/lib/documentApi.test.ts` (extends existing document API coverage for empty list and list failure)
- `DATADARSHANAM_MISSION_10_COMPLETION.md`
  - This report.

No dependency, database migration, embedding/retrieval, answer-generation, CSV analytics, chart, `/api/query`, or authentication implementation change was made.

## Implemented user flows

1. The existing document manager loads, uploads, displays processing states, and deletes documents using its existing API and behavior. Its loaded list is shared with the Q&A panel rather than introducing another document-management API or CRUD system.
2. The panel shows loading, list errors, empty documents, signed-out state, and account-configuration failures.
3. A user can select any subset of ready documents. With no checkboxes selected, the interface clearly states that all of the user's ready documents are in scope. Non-ready documents cannot be selected.
4. The question is trimmed, limited to 5,000 characters, and sent with `documentIds` only when there is a selected subset. The browser sends the current bearer token; it does not call Groq or construct a general-knowledge fallback.
5. A pending state disables repeated interaction; a synchronous lock also prevents duplicate submissions.
6. API statuses are handled distinctly:
   - `answered`: render answer and validated sources.
   - `insufficient_evidence`: render the answer endpoint's abstention, with no citations.
   - `no_evidence`: explain that no matching passages were found and show no sources.
   - `FEATURE_DISABLED`: show a non-technical unavailable message and disable further submissions for that mounted panel.
   - expired authentication, malformed responses, network errors, retrieval/provider errors, and other non-2xx responses produce safe user messages.
7. Example questions populate the field only; they do not submit or represent completed answers.

## API contract and citation rendering

The client uses the Mission 9 request shape:

```json
{
  "question": "How many annual leave days are provided?",
  "documentIds": ["11111111-1111-4111-8111-111111111111"]
}
```

`documentIds` is omitted when searching all ready documents. The client validates `success`, status, answer, and source fields against the existing Mission 9 response contract. It requires sources for `answered`, and requires empty sources for `no_evidence` and `insufficient_evidence`; malformed or duplicate chunk references are not displayed.

The UI renders answer text and document/source metadata as ordinary React text. It does not interpret HTML or Markdown, create URLs from returned values, or display any citation when `sources` is empty. Source display uses only server-returned document name, page and section metadata, canonical chunk index, and source offsets.

## Accessibility and responsive behavior

- Uses labelled question and document controls, semantic fieldset/legend and headings, button submit semantics, and live status/error regions.
- Keyboard interaction is supported through standard textarea, checkbox, and button controls; focus-visible styling comes from the existing global styles.
- Uses the existing dark visual language and responsive padding/flex wrapping, with the document list constrained to a scrollable region on smaller viewports.
- Answer content is plain text, avoiding unsafe HTML rendering.
- No chat history, streaming, or conversation persistence was added.

## Existing functionality preserved

- Existing CSV upload, analytics conversation, charts, dashboard controls, `/api/query` request/response behavior, Supabase sign-in, and existing document upload/deletion flows remain in place.
- The Q&A panel is added to the existing home workspace; no analytics page redesign or navigation rewrite was performed.
- The shared document list is still loaded through the existing authenticated document-list API. No unsupported retry endpoint or action was invented.

## Verification

Ran from `frontend` unless otherwise noted:

| Command | Result |
|---|---|
| `npx tsc --noEmit` | **PASS**, exit 0, no diagnostics. |
| `npm test` | **PASS**, 26 test files and 132 tests. Vitest emitted a Vite CJS Node API deprecation notice and an expected `Document listing failed` stderr message from the existing sanitized-list-failure test. |
| `npm run lint` | **PASS**, exit 0 with 2 existing warnings in unchanged `src/components/ChartView.tsx` lines 55–56 for `plotData`/`plotLayout` Hook dependencies. No Mission 10 lint warnings. |
| `npm run build` | **PASS**, exit 0; production build succeeded and Next.js generated 12 static pages. |
| `git diff --check` | **PASS**, exit 0 with no whitespace errors. Git printed LF-to-CRLF conversion notices for seven pre-existing modified frontend files; these are not whitespace failures. |

Automated tests mock API and authentication boundaries. They cover token use, response validation, disabled and unauthorized responses, malformed/network failures, no-evidence/abstention, source data integrity, document-list empty/failure paths, ready-only scope, selection toggling, and duplicate-submit locking. They do not prove live provider, database, authorization, deployment, or browser-session behavior.

## Limitations and follow-up

- The existing documents API exposes document extraction state but not embedding-job readiness. A document marked `ready` in the UI is known to have completed extraction, but it may not yet have successfully persisted embeddings. Such a document can legitimately produce `no_evidence`. The panel communicates that retrieval evidence may still be unavailable.
- The existing document manager has no retry action or supported retry endpoint. Failed processing is shown as failed; the Q&A panel does not invent a retry control.
- The UI displays source location metadata but cannot navigate to a document excerpt because no authorized document-view/source-navigation endpoint or UI is present.
- There is no frontend-level feature-flag discovery endpoint. The UI learns that the server flag is disabled on the first attempted answer request, then stops further submissions in that mounted panel.
- A selected set that no longer corresponds to ready documents can return no evidence; server-side ownership and ready-state filtering remain authoritative.
- The answer text's safety/grounding is not independently established by UI response validation. The browser can verify response structure and source metadata, not semantic entailment.

## Live verification status

**UNVERIFIED:** no live Supabase, Gemini, Groq, or Vercel integration was exercised. No migration was applied, no deployment was performed, no runtime feature flag was enabled, and no credentials were inspected or added.

Before any deployed enablement, complete the Mission 8–9 non-production database/provider authorization and quality checks, verify the document embedding workflow can create ready retrieval records, test the current browser session and expired-token flow, and validate the deployed Vercel runtime/feature-flag configuration. Keep `DOCUMENT_RAG_ANSWERS_ENABLED=false` until those checks pass.

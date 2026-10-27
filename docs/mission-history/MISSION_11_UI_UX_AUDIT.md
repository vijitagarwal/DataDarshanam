# Mission 11 — UI/UX audit and redesign plan

**Audit date:** 2026-10-27  
**Scope:** source-based frontend audit and attempted local visual inspection  
**Branch:** `feature/document-rag-v1` at checkpoint `d1c6240`  
**Status:** audit and recommendations only; no application, API, authentication, provider, or migration changes

## Executive summary

DataDarshanam is a single-page Next.js workspace that puts CSV analytics, account controls, private document management, and document Q&A into one scrolling surface. The product already has a coherent dark palette, working chart controls, result tables, and a useful document answer flow. The main UX opportunity is not to add more dashboard decoration: it is to make the two distinct jobs—**explore a dataset** and **ask private documents**—legible, navigable, and appropriately prioritized without breaking either workflow.

The largest observed concerns are:

1. The document manager and Q&A panel are placed before the analytics welcome or conversation in the same scroll region. This makes the initial workspace long and gives two separate products equal visual weight without a clear mode distinction.
2. The current mobile navigation uses a slide-in sidebar but has no observed Escape dismissal, focus trap, or focus restoration. The page itself is fixed to viewport height and has nested scrolling regions.
3. Several controls and feedback paths need stronger accessibility and consistency: the analytics prompt has no visible label, CSV upload failures use a browser alert, sign-in is an unlabeled popover form rather than a dialog, and many controls use very small text.
4. Loading and error states use different patterns across analytics, documents, and Q&A; document lists have no skeleton, and the CSV upload flow does not present an in-page progress/result summary.
5. The product has multiple competing style systems: global custom CSS utilities, long inline Tailwind class strings, and a small set of Base UI/shadcn-style primitives that are not consistently used.

These are source observations, not results from an accessibility audit or a successful browser rendering. The redesign should preserve the existing capabilities and contracts while first addressing information architecture, task feedback, and keyboard/responsive behavior.

## Audit method and evidence limits

Reviewed the current Git branch and worktree, frontend entry point and layout, global styles, page composition, authentication, CSV navigation and query components, charts/results/dashboard components, document manager and Q&A panel, UI primitives, and frontend package/test configuration. Findings below cite the inspected files.

Attempted local visual inspection by starting the Next.js development server and opening `http://127.0.0.1:3000`. The server reached “Ready”, but compiling the page failed with `Can't resolve 'tailwindcss'` while resolving from the repository root. The integrated browser connection also timed out. The server was stopped afterward. **No screenshot, viewport rendering, live API request, or visual pass/fail is claimed.** A prior production build is not a substitute for rendering inspection.

The repository was on `feature/document-rag-v1` at `d1c6240`, tracking `origin/feature/document-rag-v1`, with `main` still at `a6a869b`; the worktree and index were clean before this report. No automated test, lint, or build command was run for this audit.

## Current architecture and visual system

### Application composition

- [`frontend/src/app/layout.tsx`](../../frontend/src/app/layout.tsx) sets the global Inter and Noto Sans Devanagari fonts, dark mode, and page metadata.
- [`frontend/src/app/page.tsx`](../../frontend/src/app/page.tsx) owns the analytics page state, dataset and conversation flow, sidebar state, and shared document-list state. It renders a persistent left sidebar, compact top bar, scrollable content area, and sticky analytics prompt.
- The main content order is: shared document manager and Q&A panel, then the analytics hero or query/dashboard history. The Q&A itself is a second question interface with its own submit controls.
- [`frontend/src/components/Sidebar.tsx`](../../frontend/src/components/Sidebar.tsx) contains query history, dataset profile and CSV upload, saved charts/export, and “How It Works”. At narrow widths it becomes a fixed slide-in drawer with a scrim.
- Analytics results are composed from [`QueryResult.tsx`](../../frontend/src/components/QueryResult.tsx), [`KpiTiles.tsx`](../../frontend/src/components/KpiTiles.tsx), [`ChartView.tsx`](../../frontend/src/components/ChartView.tsx), [`InsightCard.tsx`](../../frontend/src/components/InsightCard.tsx), and [`FilterPills.tsx`](../../frontend/src/components/FilterPills.tsx). Full dashboard results use [`DashboardView.tsx`](../../frontend/src/components/DashboardView.tsx).
- Document authentication is exposed in [`AuthControl.tsx`](../../frontend/src/components/AuthControl.tsx). The document workspace and Q&A are implemented in [`DocumentManager.tsx`](../../frontend/src/components/DocumentManager.tsx) and [`DocumentQaPanel.tsx`](../../frontend/src/components/DocumentQaPanel.tsx).

### Existing visual language

- Dark canvas (`#0a0d14`), dark sidebar (`#0d1117`), slate/navy surfaces (`#141b2d`), slate text, and indigo/violet accents are defined in [`frontend/src/app/globals.css`](../../frontend/src/app/globals.css).
- The design favors rounded cards, translucent/gradient accents, glow shadows, chips, and light hover movement. Shared `.glass-card`, `.btn-primary`, `.pill-chip`, gradient text, focus-visible outlines, reduced-motion handling, and shimmer animation are defined globally.
- Most layout, spacing, colors, and interaction styling are expressed through Tailwind utility classes directly in components. Several shared primitives exist under [`frontend/src/components/ui/`](../../frontend/src/components/ui/), but audited product components mostly style native controls themselves.
- Inter is the primary typeface; Noto Sans Devanagari is used for the product wordmark. There is no documented spacing/type/color token scale beyond the CSS custom properties.
- Breakpoint usage is primarily Tailwind `sm`, `md`, and `lg`. The desktop sidebar is 18rem wide; the main workspace and results are generally capped at `max-w-5xl` or `max-w-4xl`.

## Existing user journeys

### Landing and authentication

The root route loads the CSV schema and renders the analytics hero when there are no chat entries. `AuthControl` is always present in the top bar when Supabase client configuration is available. Signed-out users see a sign-in button that opens a small absolute-positioned email/password form; signed-in users see their email (hidden below `sm`) and a sign-out button. `DocumentManager` returns no UI unless a user is signed in, while Q&A shows session loading, configuration failure, or a sign-in prompt.

**Implication:** analytics is immediately available without sign-in, while document workflows require account setup. This distinction is correct but not yet presented as a clear product choice or navigation mode.

### CSV upload and dataset exploration

CSV upload is initiated from the sidebar’s hidden file input through “Upload Custom CSV”. On success, the page updates the active dataset profile/name and clears conversation and saved charts. On failure, a browser alert appears and the sidebar schema error is set. Dataset profile details include row/column counts, a subset of metrics/dimensions, and an expandable schema list.

**Implication:** upload is discoverable in the sidebar, but the selected dataset, upload result, and failure recovery are not expressed as a dedicated workspace state. The file input has no visible associated label.

### Analytics query and results

The hero offers example questions and a full-dashboard action. The sticky [`ChatInputBar.tsx`](../../frontend/src/components/ChatInputBar.tsx) uses a rotating placeholder and send icon. Submissions append a conversation item; requests containing “dashboard” or “overview” take the dashboard route, otherwise the query route. Errors render in a result card.

Successful results show active filters, four KPI tiles, chart controls, CSV export, saved-chart action, insight card, a short table preview, and an expandable full result table. Dashboard charts stack on mobile and switch to two columns at `md`.

**Implication:** the result supports exploration, but chart/table actions and their state are distributed across a dense card. Query and result semantics depend on placeholder/content rather than a persistent explicit label and mode.

### Document upload, status, selection, and deletion

Signed-in users can upload PDF, DOCX, TXT, or Markdown documents. The manager shows a text loading state, a dashed empty state, document rows with size/status, upload confirmation/error, and a confirmation dialog through `window.confirm` before deletion. Failed processing can expose an ingestion error message; there is no retry action. The document list is shared with Q&A rather than fetched twice.

**Implication:** the core operations exist, but status, upload, selection, and deletion use separate visual patterns and text-size levels. The list has no skeleton, per-row action state, or in-page delete-confirmation treatment.

### Document Q&A, citations, and feedback

The Q&A panel distinguishes auth loading, signed-out/configuration state, document loading/empty/error states, all-ready-documents versus selected scope, question validation and character count, pending submit, feature-disabled, network/provider errors, no evidence, insufficient evidence, answered content, and server-returned sources. Question examples fill the field without submitting. Sources are rendered as text and do not create navigation links.

**Implication:** this is the most complete state model in the UI. Its panel shares the page with a second, separate query entry point and competes for vertical space; several similar status/error patterns could be consolidated without changing behavior or API contracts.

## Findings: observed issues and evidence

Severity is a planning assessment, not an automated score.

| Priority | Observed issue | Evidence and user impact |
|---|---|---|
| High | Two workflows share one long page with no clear mode/navigation distinction. | [`page.tsx`](../../frontend/src/app/page.tsx) always places document workspace/Q&A before analytics content. Signed-in users must scroll past both panels to reach the analytics hero or conversation. This dilutes task focus and lengthens the primary landing experience. |
| High | Small-screen viewport and nested-scroll behavior need validation and likely refinement. | [`page.tsx`](../../frontend/src/app/page.tsx) uses `h-screen w-screen overflow-hidden`; its main area and sidebar each scroll independently, and the analytics prompt is sticky. [`Sidebar.tsx`](../../frontend/src/components/Sidebar.tsx) uses a fixed drawer/scrim under `md`; document lists and selection lists add their own `max-h` scrolling. On short/tall mobile viewports this can create competing scroll areas or hide content. Source inspection cannot establish actual clipping. |
| High | Keyboard behavior for the mobile sidebar is incomplete in the inspected implementation. | [`Sidebar.tsx`](../../frontend/src/components/Sidebar.tsx) opens/closes through buttons and a scrim but has no observed Escape handler, focus trap, or focus return. The sign-in popover in [`AuthControl.tsx`](../../frontend/src/components/AuthControl.tsx) is not exposed as a labelled dialog and has no observed Escape/outside dismissal or focus management. |
| High | The CSV upload control lacks an explicit accessible name and its failure feedback is disruptive. | The hidden file input in [`Sidebar.tsx`](../../frontend/src/components/Sidebar.tsx) has no visible associated `<label>`; activation is via an adjacent button. [`page.tsx`](../../frontend/src/app/page.tsx) uses `alert()` for upload errors instead of a persistent, contextual, announced message. |
| Medium | Analytics question field is identified by its placeholder rather than a persistent label. | [`ChatInputBar.tsx`](../../frontend/src/components/ChatInputBar.tsx) renders a text input with rotating placeholder and no visible label or `aria-label`. Placeholder text changes and disappears during input. The send-only icon button has no explicit `aria-label`. |
| Medium | Loading and feedback conventions vary between workflows. | Analytics uses a shimmer skeleton in [`page.tsx`](../../frontend/src/app/page.tsx); schema and document loading use text/spinners; Q&A uses status/error callouts; CSV upload uses `alert()`. The document list has no skeleton and its upload state changes the button text without a progress indication. Users receive different feedback for similarly asynchronous actions. |
| Medium | Primary action controls are compact and many text styles are very small. | Sidebar metadata and action labels frequently use `text-[10px]`/`text-[11px]`; the document manager uses `text-xs`; KPI labels use `text-[10px]`. This creates legibility and touch-target risk, especially at narrow widths or browser zoom. Contrast and target-size compliance were not measured. |
| Medium | Destructive/expanded actions are not consistently exposed to assistive technology. | The saved-chart delete button in [`Sidebar.tsx`](../../frontend/src/components/Sidebar.tsx) has only an icon and no accessible label. Expanders in Sidebar and [`QueryResult.tsx`](../../frontend/src/components/QueryResult.tsx) do not expose `aria-expanded`/`aria-controls`. Data tables have headers but no caption or explicit `scope` attributes. |
| Medium | Error/status states could be more recoverable and more specific in context. | Schema errors are surfaced in the sidebar, CSV failures in an alert, document failures in the manager and Q&A, and analytics errors in query-result cards. Most errors do not consistently pair a clear next action (retry, choose another dataset, sign in, or inspect a processing state) with the message. Do not invent a retry when no API behavior exists. |
| Medium | Saved insight export is built by interpolating user/model strings into HTML. | [`Sidebar.tsx`](../../frontend/src/components/Sidebar.tsx) inserts query and insight strings directly into generated HTML. This is a security/accessibility review item as well as a visual consistency issue; any redesign of export must preserve output functionality and safely escape content. This audit does not change or test that behavior. |
| Low | Analytics result surface is visually dense and uses several competing accents. | [`QueryResult.tsx`](../../frontend/src/components/QueryResult.tsx) places filters, KPI tiles, chart controls, chart actions, insight, preview table, and expandable table together. Indigo/violet, pink, emerald, and amber all signal state or action; the intended semantic meaning is not documented. |
| Low | Multiple style conventions make future restyling costly. | [`globals.css`](../../frontend/src/app/globals.css), inline utility strings across feature components, and the Base UI/shadcn-like primitives under [`components/ui/`](../../frontend/src/components/ui/) coexist. Components such as `DocumentManager` and `DocumentQaPanel` repeat panel, button, status, and field styles rather than using a shared product-level variant system. |
| Low | Product language and initial content emphasize implementation details. | [`HeroState.tsx`](../../frontend/src/components/HeroState.tsx) leads with model/engine badges and feature cards, while the actual primary task is querying a dataset. The sidebar “How It Works” copy names Pandas even though the deployed TypeScript route is the active analytics implementation; this is a content inconsistency to verify before redesign. |

## Proposed visual direction

### Direction: “Analyst’s workbench”

Create a calm, precise instrument for exploring business data: compact navigation, clear task mode, strong typographic hierarchy, and charts/tables treated as primary content. Keep the dark canvas and brand indigo as recognizable anchors, but reduce glow, gradients, and translucent-card repetition. Use surfaces and color to encode hierarchy and state, not as decoration.

This direction is a recommendation, not an assumption that the current brand colors or dark-only mode must remain permanently fixed. Validate it with the product owner before implementation if a light mode or brand change is in scope.

### Design principles

1. **One primary task at a time:** keep analytics and document intelligence distinct but easy to switch between; do not make a user scroll through one workflow to reach the other.
2. **Data before decoration:** give results, evidence, and data controls priority over hero feature cards and engine/model badges.
3. **Every asynchronous action has a stable place:** show progress and completion/error feedback close to the initiating control.
4. **Progressive disclosure:** keep schema, full tables, advanced chart controls, and source metadata available but avoid presenting every detail at once.
5. **Explicit scope and provenance:** show active dataset for analytics and selected/all-ready document scope for Q&A; preserve server-sourced citations exactly.
6. **Accessible by default:** persistent labels, semantic landmarks, keyboard-safe overlays, visible focus, adequate contrast, and touch targets are component requirements, not finishing work.
7. **Reuse a small system:** consistent panel, field, button, badge/status, alert, empty, skeleton, and confirmation patterns.

### Tokens and typography recommendations

- Keep Inter for primary Latin UI and Noto Sans Devanagari for the wordmark; avoid adding fonts until the current pair has been evaluated in the real layouts.
- Define a compact type ramp with named roles (page title, section title, body, supporting text, metadata) and avoid `10px` labels for important user-facing actions/statuses. Use a comfortable default body size and reserve compact text for secondary metadata.
- Establish spacing tokens (for example 4/8/12/16/24/32/48 px) and radii (small controls, cards, dialogs) instead of arbitrary per-component values.
- Retain a deep ink background and neutral elevated surfaces. Use indigo for primary actions/focus, a restrained cyan/teal for data visualization only where contrast and chart distinction support it, and semantic green/amber/red only for success, caution, and error. Verify every text/state combination against WCAG AA in the implemented theme.
- Prefer solid or subtly tinted surfaces with clear borders. Reduce routine gradient fills, glow shadows, and hover lifts; reserve them for a limited primary action or brand accent.
- Keep charts multicolor where data encodings require it, but separate chart-series colors from UI status colors and ensure non-color cues remain available.

## Recommended responsive layouts

These are proposed target layouts; none was visually validated in a browser during this audit.

### Desktop (at least 1280 px)

- Use a persistent compact left rail for top-level **Analytics** and **Documents** navigation plus brand/account controls; keep dataset/query history and saved views contextual to Analytics rather than mixing them with document navigation.
- Give each mode a clear page title and a bounded content column. Keep dataset identity and upload/switch-dataset action visible in the Analytics header.
- Analytics: query composer near the top, then results with KPI strip and chart as primary content; put insight and table preview in a secondary column only when width allows.
- Documents: document list/workspace with upload, status and row actions; Q&A can occupy a neighboring or following panel, with explicit scope summary and answer/source section.
- Keep chart/table tools discoverable but visually secondary to the result.

### Tablet (approximately 768–1279 px)

- Collapse the full sidebar to a compact rail or drawer before it competes with the content width. Avoid a 288 px sidebar plus a multi-column analytics result at smaller tablet widths.
- Use a single main column for analytics results; retain a compact KPI grid and move insight/table preview below or into a clearly labeled secondary region.
- For document mode, stack the document list and Q&A with selected scope retained near the question composer.
- Ensure modal/popover content fits the viewport and that controls do not rely on hover.

### Mobile (below approximately 768 px)

- Use a simple top bar with a labelled menu/navigation control and a single scroll container. Prefer document-flow layout over a fixed `100vh` canvas where mobile browser chrome could constrain content.
- Place the active workflow’s task input near the start of its screen; do not stack both full document panels above analytics by default.
- Stack KPIs in two columns only when labels and values remain readable; otherwise use horizontally scrollable, screen-reader-friendly KPI cards or a vertical summary.
- Render chart controls as horizontally scrollable or wrapped controls with sufficiently large targets. Keep chart and table data navigable without forcing tiny text.
- Keep upload, delete, document selection, Q&A scope, and submit actions reachable without nested vertical scrolling. Any drawer/dialog needs an explicit close action and safe focus behavior.

## Accessibility and interaction-state checklist

### Semantics and labels

- [ ] One descriptive page-level `<h1>` per mode and ordered section headings.
- [ ] Persistent visible labels for analytics question, CSV file selection, document upload, sign-in fields, and Q&A question.
- [ ] Explicit accessible names for icon-only buttons; stateful disclosure buttons expose `aria-expanded` and `aria-controls`.
- [ ] Correct table caption/header scope and responsive reading strategy.
- [ ] Status/error messages are announced with suitable live-region semantics without repeated noisy announcements.

### Keyboard and focus

- [ ] Every action works with keyboard alone; tab order follows visual order.
- [ ] Drawer/dialog/popover opens with focus placed deliberately, closes on Escape when appropriate, prevents focus from escaping modal context, and returns focus to its trigger.
- [ ] Focus indicators remain visible on dark and elevated surfaces and are not obscured by sticky headers/prompt bars.
- [ ] No keyboard trap in chart controls, document lists, menus, or tables.
- [ ] Focus and selection are preserved after upload/delete/answer completion when sensible.

### Visual access and motion

- [ ] Verify text, icon, border, disabled, hover, focus, and status contrast to WCAG AA; do not infer compliance from Tailwind color names.
- [ ] Important states are not communicated by color alone; chart categories have labels or alternative cues.
- [ ] Interactive targets meet minimum target-size expectations, especially on touch devices.
- [ ] Test 200% zoom, text scaling, narrow screens, and short landscape viewports.
- [ ] Respect `prefers-reduced-motion`; avoid mandatory shimmer/animation.

### Workflow states

- [ ] Analytics schema initial loading, schema failure, CSV upload pending/success/failure, empty dataset, query pending/failure/success, and dashboard state.
- [ ] Document signed-out/configuration, list loading/empty/error, upload pending/queued/processing/ready/failed, delete pending/confirmation/failure, and no-retry behavior.
- [ ] Q&A auth loading, no documents, no ready documents, scope selection, invalid question, pending submit, disabled feature, no evidence, insufficient evidence, answered with sources, authentication/provider/network failures, and malformed response.
- [ ] Preserve the distinction between extraction-ready documents and embedding/retrieval readiness; do not imply that a visible “ready” status guarantees evidence is retrievable.

## Prioritized implementation plan

Each phase should be separately reviewed and tested. This is a plan only; no phases were implemented here.

### Phase 0 — Baseline and design token inventory

- Re-establish a working local visual baseline after investigating the development-server Tailwind resolution failure. Do not change application architecture merely to bypass it.
- Capture desktop/tablet/mobile screenshots of current states when the local app runs; establish representative signed-out, analytics, document, and Q&A fixtures/mocks.
- Agree on mode/navigation approach, visual direction, breakpoints, text scale, contrast target, and whether dark-only remains the product decision.
- **Exit:** reproducible local render, baseline screenshots, accepted token proposal, and a documented list of unchanged contracts.

### Phase 1 — Shared visual/accessibility primitives

- Define design tokens for colors, spacing, typography, radii, borders, elevations, and focus.
- Consolidate repeated panel, button, field, badge/status, alert, skeleton, empty-state, and confirmation patterns using the repository’s existing Base UI primitives where appropriate.
- Maintain semantic variants; avoid introducing a new component library unless a concrete gap is demonstrated.
- **Exit:** existing page can be restyled through shared primitives without changing API or business behavior; focused keyboard/contrast checks pass.

### Phase 2 — Workflow navigation and page shell

- Separate Analytics and Documents as clear modes while keeping both discoverable.
- Remove the need to scroll through document Q&A to reach the analytics task, and make dataset/account context visible in the shell.
- Implement responsive single-scroll behavior and a fully keyboard-safe mobile navigation drawer.
- **Exit:** both workflows reachable in one action at desktop/tablet/mobile, no lost content at viewport/zoom tests, CSV and document state remains independent.

### Phase 3 — Analytics task and result hierarchy

- Refine dataset context/upload feedback, give the prompt a persistent label and accessible submit action, and improve query loading/error recovery.
- Rebalance KPI, chart, insight, filter, table, save, and export hierarchy without changing their calculations or interactions.
- Keep dashboard and individual-query paths distinct in presentation while preserving current routing heuristics/API payloads.
- **Exit:** analytics regression suite passes; chart-type switcher, full dashboard, CSV export, saved charts, history, and CSV upload work in scripted checks.

### Phase 4 — Document workspace and Q&A clarity

- Refine upload/list/status/delete affordances; keep unsupported retry behavior absent.
- Improve scope-selection presentation and align Q&A pending, empty, disabled, error, answer, and source states with the shared patterns.
- Keep source metadata as server-returned text; do not invent navigation URLs, citation data, answer persistence, or provider fallback.
- **Exit:** mocked document and answer scenarios pass; scope and all evidence states are clear at target viewports.

### Phase 5 — Visual QA, accessibility, and regression gate

- Test desktop, tablet, mobile portrait/landscape, 200% zoom, keyboard-only, reduced motion, and screen-reader labels/live feedback.
- Measure contrast and target sizes; use browser automation for important flows and visual comparison for key states.
- Run existing typecheck, unit tests, lint, and production build. Distinguish existing warnings from newly introduced ones.
- **Exit:** accepted screenshot set, no P0/P1 accessibility or workflow regression, all existing feature contracts retained.

## Regression risks and test plan

### Risks to manage

- Reordering or hiding panels can accidentally make Q&A seem enabled while `DOCUMENT_RAG_ANSWERS_ENABLED=false`; preserve the existing disabled-state message and do not alter the feature flag.
- A new mode shell could unmount stateful components. Decide deliberately whether analytics history, saved charts, selected documents, and in-progress questions persist on mode changes; do not add server persistence or chat history by implication.
- Responsive chart containers and changed parent widths can affect Plotly resize behavior and chart controls.
- Reworking CSV upload/notifications risks clearing dataset/query state differently than today.
- Account changes must continue clearing prior-user documents and selections; never make client-side IDs an authorization mechanism.
- Styling or text changes must not trust answer/document content as HTML. Review the saved-HTML export as a separate security fix if modifying it.
- Retain user-facing semantics around document processing and retrieval readiness; extraction `ready` is not proof of embedding readiness.

### Test matrix

- **Existing automated suite:** run `npx tsc --noEmit`, `npm test`, `npm run lint`, and `npm run build` from `frontend`; preserve API/answer/retrieval tests as behavior gates. These were not run for Mission 11.
- **Component interaction tests:** add focused tests consistent with Vitest for navigation state, keyboard dismissal/focus behavior, upload/status feedback, and accessibility attributes. Existing tests do not provide broad rendered UI coverage.
- **Browser flow tests:** use mocked API/provider responses for signed-out and signed-in shells, CSV upload and failure, analytics query and dashboard, chart switcher, save/export/remove, document upload/status/delete, Q&A scope, each answer status/error, and disabled flag.
- **Viewport checks:** at minimum 1440×900 desktop, 1024×768 tablet, 390×844 mobile, and short landscape; test no unintended horizontal scrolling, nested-scroll traps, clipped popovers, and usable charts/tables.
- **Accessibility checks:** keyboard-only navigation, automated axe scan if available, screen-reader naming/landmark review, visible focus, contrast measurement, 200% zoom, reduced motion, and touch-target review.
- **Visual checks:** capture reference screenshots for analytics empty/loading/result/dashboard and document empty/list/Q&A answered/disabled states; compare after each UI phase. Mocks are not live integration verification.
- **Live boundaries:** do not apply migrations, deploy, enable the answer flag, or claim Supabase/Gemini/Groq/Vercel behavior from UI tests.

## Functionality that must remain unchanged

- CSV upload limits, dataset selection/profile semantics, natural-language analytics request and response contract, `/api/query`, dashboard route, chart specifications/calculations, chart-type switching, KPI summary behavior, filters, full result table, saved charts/history, and CSV/HTML export behavior.
- Existing authentication mechanism, verified user identity, owner-scoped document access, upload/processing/status/deletion semantics, Supabase RLS/RPC assumptions, and account-change isolation behavior.
- Existing retrieval and embedding identity, canonical chunks and source offsets, answer-generation path, citation validation, abstention states, and `POST /api/answers` contract.
- `DOCUMENT_RAG_ANSWERS_ENABLED=false` as the safe default; no new client-side provider calls or ungrounded fallback.
- No migration changes, backend/provider changes, deployment, production configuration edits, or pushes as part of the redesign implementation unless separately authorized.

## Files inspected

- `frontend/src/app/page.tsx`, `frontend/src/app/layout.tsx`, `frontend/src/app/globals.css`
- `frontend/src/components/Sidebar.tsx`, `HeroState.tsx`, `ChatInputBar.tsx`, `AuthControl.tsx`
- `frontend/src/components/DocumentManager.tsx`, `DocumentQaPanel.tsx`
- `frontend/src/components/QueryResult.tsx`, `DashboardView.tsx`, `ChartView.tsx`, `KpiTiles.tsx`, `InsightCard.tsx`, `FilterPills.tsx`
- `frontend/src/components/ui/button.tsx`, `card.tsx`, `input.tsx`, `skeleton.tsx`
- `frontend/package.json`, `frontend/components.json`, `frontend/postcss.config.mjs`, `frontend/next.config.ts`

## Checks and outcome

- **Git:** confirmed branch `feature/document-rag-v1`, HEAD `d1c6240`, clean index/worktree at audit start, and unchanged `main` at `a6a869b`.
- **Source audit:** completed for current page composition, workflow components, styles, breakpoints, state/feedback patterns, and existing shared primitives.
- **Local visual attempt:** development server became ready, but page compilation failed on Tailwind resolution from the repository root; the integrated browser connection also timed out. The server was stopped. **No visual inspection or screenshot verification was completed.**
- **Automated checks:** none run for this documentation-only audit.
- **Code changes:** none; this report is the only intended change.

## Recommended next mission

**Mission 12: establish a reliable local visual baseline and implement Phase 0–1 only.** First investigate why the development server resolves `tailwindcss` from the repository root while the production build had succeeded; capture representative current screenshots once local rendering works. Then agree on the design tokens and implement shared, accessible visual primitives without changing workflows. Keep navigation/layout reorganization for a later separately reviewed phase.

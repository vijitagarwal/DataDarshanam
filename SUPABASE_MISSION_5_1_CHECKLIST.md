# Mission 5.1 — Supabase integration checklist

This guide is for a **non-production** Supabase project. No live Supabase project was configured or tested during Mission 5.1; every check below remains **UNVERIFIED**.

## One-time setup

1. Create a non-production Supabase project.
2. Enable the intended Auth provider. The application currently supports password sign-in only; it does not silently enable public registration.
3. Configure the site URL and redirect URLs for the local frontend origin.
4. Configure the frontend environment with:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` only in the server environment
5. Apply `supabase/migrations/20261026190000_mission4_documents.sql`.
6. Confirm the `documents` bucket is private.
7. Confirm the database grants, RLS policies, and Storage policies match the migration.

## Two-user test data

Create two distinct test accounts, `user A` and `user B`, through the configured Supabase Auth policy. Do not reuse tokens between users. Record only non-sensitive test identifiers; never place access or service-role tokens in source control or logs.

## Authentication and token expiry

1. Sign in as user A and verify the browser shows the account email.
2. Call `GET /api/documents` with A's access token: expected `200`.
3. Repeat without `Authorization`: expected `401 UNAUTHENTICATED`.
4. Repeat with an expired or revoked token: expected `401 UNAUTHENTICATED`; response must not contain provider details.
5. Sign out and confirm document management disappears or becomes unavailable.

## Signed upload and ownership

1. As user A, initialize a valid PDF upload.
2. Confirm the response path is exactly `A-user-id/document-id/original.pdf`.
3. Confirm the path is not client-selected and the response contains only a short-lived upload token.
4. Upload the bytes with Supabase's signed-upload client method.
5. Attempt to use A's token with user B's path: expected failure.
6. Attempt to overwrite another user's existing object: expected failure.
7. Attempt a wrong extension, mismatched MIME type, zero-byte size, and over-limit size: expected `400`.
8. Complete the upload and verify the server checks object existence and actual stored size.
9. Repeat completion: expected an idempotent success response.
10. Send two completion requests concurrently: one job may be created; both responses must be safe and must not create duplicate active jobs.

## Isolation and deletion

1. As user A, list documents and confirm only A's records appear.
2. As user B, list documents and confirm A's record does not appear.
3. As user B, request A's status and deletion endpoints: expected `404` without ownership disclosure.
4. As user A, delete the document and verify both private object and metadata are removed.
5. Force or simulate a Storage deletion failure in the test project. The API must return the retryable cleanup response and retain metadata in a cleanup-pending state.
6. Retry deletion after Storage recovers and verify metadata cleanup completes.

## Database and Storage verification

In the Supabase SQL editor or approved integration harness:

1. Set a user JWT context and verify `auth.uid()` is the expected user.
2. Confirm authenticated `SELECT` returns only rows owned by that user.
3. Confirm anonymous access is denied.
4. Confirm browser-role `INSERT`, `UPDATE`, and `DELETE` on metadata are denied.
5. Confirm ownership, storage bucket, and storage path cannot be changed.
6. Confirm ingestion jobs cannot be created with a user ID different from the document owner.
7. Confirm Storage list/download/upload/delete policies enforce the first path segment as the authenticated user ID.
8. Confirm the service-role key is never present in browser bundles, responses, or logs.

## Result recording

Record each check as `PASS`, `FAIL`, or `UNVERIFIED` with:

- date and environment,
- test-user identifiers (not tokens),
- endpoint and status,
- safe error code,
- remediation issue if failed.

Mission 5.1 local mocks passing does not prove live RLS, Storage, signed-upload, or PostgreSQL trigger behavior.

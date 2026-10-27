-- Mission 4: document ownership and ingestion metadata foundation.
-- No pgvector column or embedding dimension is declared in this migration.
-- Add vectors only after the embedding model dimension is verified.

create extension if not exists pgcrypto;

create type public.document_status as enum (
  'awaiting_upload',
  'queued',
  'processing',
  'ready',
  'failed',
  'deleting',
  'deleted'
);

create type public.ingestion_status as enum (
  'queued',
  'processing',
  'ready',
  'failed'
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  original_filename text not null check (length(btrim(original_filename)) between 1 and 255),
  media_type text not null check (length(media_type) between 1 and 127),
  file_extension text not null check (file_extension in ('pdf', 'docx', 'txt', 'md', 'markdown')),
  byte_size bigint not null check (byte_size > 0),
  storage_bucket text not null default 'documents'
    check (storage_bucket = 'documents'),
  storage_path text not null unique,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  status public.document_status not null default 'awaiting_upload',
  ingestion_error_code text,
  ingestion_error_message text,
  extraction_version text,
  chunking_version text,
  embedding_model text,
  embedding_dimension integer check (embedding_dimension is null or embedding_dimension > 0),
  chunk_count integer not null default 0 check (chunk_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  check (status <> 'ready' or completed_at is not null),
  check (status <> 'deleted' or deleted_at is not null)
);

create index documents_user_created_idx
  on public.documents (user_id, created_at desc);
create index documents_user_status_idx
  on public.documents (user_id, status);
create unique index documents_user_hash_idx
  on public.documents (user_id, sha256)
  where sha256 is not null and deleted_at is null;

create table public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.ingestion_status not null default 'queued',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'processing' or started_at is not null),
  check (status not in ('ready', 'failed') or finished_at is not null)
);

create index ingestion_jobs_status_idx
  on public.ingestion_jobs (status, created_at);
create index ingestion_jobs_user_idx
  on public.ingestion_jobs (user_id, created_at desc);
create unique index ingestion_jobs_one_active_idx
  on public.ingestion_jobs (document_id)
  where status in ('queued', 'processing');

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger documents_touch_updated_at
before update on public.documents
for each row execute function public.touch_updated_at();

-- Prevent client or worker code from transferring ownership or changing the
-- storage location after creation. Status and ingestion metadata remain
-- server-controlled through the privileged ingestion path.
create or replace function public.prevent_document_identity_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.user_id <> old.user_id
    or new.storage_bucket <> old.storage_bucket
    or new.storage_path <> old.storage_path then
    raise exception 'document ownership and storage identity are immutable';
  end if;
  return new;
end;
$$;

create trigger documents_identity_immutable
before update on public.documents
for each row execute function public.prevent_document_identity_change();

create or replace function public.prevent_ingestion_owner_mismatch()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  document_owner uuid;
begin
  select user_id into document_owner
  from public.documents
  where id = new.document_id;
  if document_owner is null or new.user_id <> document_owner then
    raise exception 'ingestion job owner must match document owner';
  end if;
  return new;
end;
$$;

create trigger ingestion_jobs_owner_matches_document
before insert or update on public.ingestion_jobs
for each row execute function public.prevent_ingestion_owner_mismatch();

alter table public.documents enable row level security;
alter table public.ingestion_jobs enable row level security;

create policy "authenticated users read own documents"
on public.documents for select to authenticated
using (auth.uid() = user_id);

create policy "authenticated users read own ingestion jobs"
on public.ingestion_jobs for select to authenticated
using (auth.uid() = user_id);

-- Route handlers use verified user identity plus a server-only service-role
-- client for controlled writes. The service role bypasses RLS and is never
-- exposed to the browser. No direct client writes are granted here.
revoke all on public.documents from anon, authenticated;
revoke all on public.ingestion_jobs from anon, authenticated;
grant select on public.documents to authenticated;
grant select on public.ingestion_jobs to authenticated;

-- The service_role role is managed by Supabase and is intentionally not
-- granted to application clients.

-- Private object bucket. The bucket is created here so deployment does not
-- depend on a manually configured public bucket.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do update set public = false;

create policy "users read own document objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "users upload own document objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "users delete own document objects"
on storage.objects for delete to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

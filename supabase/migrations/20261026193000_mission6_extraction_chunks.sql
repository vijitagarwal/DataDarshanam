-- Mission 6: bounded extraction results and deterministic chunks.
-- This migration deliberately contains no embedding column or vector dimension.

create table public.document_extractions (
  document_id uuid primary key references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  extracted_text text not null check (length(extracted_text) > 0),
  character_count integer not null check (character_count > 0),
  page_count integer check (page_count is null or page_count > 0),
  extraction_version text not null,
  chunking_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  text_content text not null check (length(btrim(text_content)) > 0),
  page_start integer check (page_start is null or page_start > 0),
  page_end integer check (page_end is null or page_end >= page_start),
  section_path text[],
  source_start integer not null check (source_start >= 0),
  source_end integer not null check (source_end > source_start),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index),
  unique (document_id, chunk_index, content_hash)
);

create index document_chunks_user_document_idx
  on public.document_chunks (user_id, document_id, chunk_index);

create trigger document_extractions_touch_updated_at
before update on public.document_extractions
for each row execute function public.touch_updated_at();

create or replace function public.prevent_extraction_owner_mismatch()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  document_owner uuid;
begin
  select user_id into document_owner from public.documents where id = new.document_id;
  if document_owner is null or new.user_id <> document_owner then
    raise exception 'extraction owner must match document owner';
  end if;
  return new;
end;
$$;

create trigger document_extractions_owner_matches_document
before insert or update on public.document_extractions
for each row execute function public.prevent_extraction_owner_mismatch();

create trigger document_chunks_owner_matches_document
before insert or update on public.document_chunks
for each row execute function public.prevent_extraction_owner_mismatch();

create or replace function public.prevent_invalid_document_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> old.status and not (
    (old.status = 'awaiting_upload' and new.status in ('queued', 'failed', 'deleting')) or
    (old.status = 'queued' and new.status in ('processing', 'failed', 'deleting')) or
    (old.status = 'processing' and new.status in ('ready', 'failed', 'deleting')) or
    (old.status = 'failed' and new.status in ('queued', 'deleting')) or
    (old.status = 'ready' and new.status = 'deleting') or
    (old.status = 'deleting' and new.status = 'deleted')
  ) then
    raise exception 'invalid document status transition';
  end if;
  return new;
end;
$$;

create trigger documents_valid_status_transition
before update on public.documents
for each row execute function public.prevent_invalid_document_transition();

create or replace function public.prevent_invalid_ingestion_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> old.status and not (
    (old.status = 'queued' and new.status in ('processing', 'failed')) or
    (old.status = 'processing' and new.status in ('ready', 'failed')) or
    (old.status = 'failed' and new.status = 'queued')
  ) then
    raise exception 'invalid ingestion status transition';
  end if;
  return new;
end;
$$;

create trigger ingestion_jobs_valid_status_transition
before update on public.ingestion_jobs
for each row execute function public.prevent_invalid_ingestion_transition();

alter table public.document_extractions enable row level security;
alter table public.document_chunks enable row level security;

create policy "authenticated users read own extractions"
on public.document_extractions for select to authenticated
using (auth.uid() = user_id);

create policy "authenticated users read own chunks"
on public.document_chunks for select to authenticated
using (auth.uid() = user_id);

revoke all on public.document_extractions from anon, authenticated;
revoke all on public.document_chunks from anon, authenticated;
grant select on public.document_extractions to authenticated;
grant select on public.document_chunks to authenticated;

-- A single privileged transaction replaces prior extraction output and advances
-- the job/document only after non-empty chunks have been validated.
create or replace function public.persist_document_extraction(
  p_document_id uuid,
  p_user_id uuid,
  p_content_hash text,
  p_extracted_text text,
  p_character_count integer,
  p_page_count integer,
  p_extraction_version text,
  p_chunking_version text,
  p_chunks jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if p_content_hash !~ '^[0-9a-f]{64}$'
    or p_extracted_text is null or length(btrim(p_extracted_text)) = 0
    or p_character_count <= 0
    or jsonb_typeof(p_chunks) <> 'array'
    or jsonb_array_length(p_chunks) = 0 then
    raise exception 'invalid extraction payload';
  end if;

  if not exists (
    select 1 from public.documents
    where id = p_document_id and user_id = p_user_id
      and status in ('queued', 'processing')
  ) then
    raise exception 'document is not owned or not processable';
  end if;

  delete from public.document_chunks where document_id = p_document_id;
  insert into public.document_extractions (
    document_id, user_id, content_hash, extracted_text, character_count,
    page_count, extraction_version, chunking_version
  ) values (
    p_document_id, p_user_id, p_content_hash, p_extracted_text, p_character_count,
    p_page_count, p_extraction_version, p_chunking_version
  )
  on conflict (document_id) do update set
    user_id = excluded.user_id,
    content_hash = excluded.content_hash,
    extracted_text = excluded.extracted_text,
    character_count = excluded.character_count,
    page_count = excluded.page_count,
    extraction_version = excluded.extraction_version,
    chunking_version = excluded.chunking_version,
    updated_at = now();

  insert into public.document_chunks (
    document_id, user_id, chunk_index, text_content, page_start, page_end,
    section_path, source_start, source_end, content_hash
  )
  select
    p_document_id,
    p_user_id,
    item.chunk_index,
    item.text,
    item.page_start,
    item.page_end,
    item.section_path,
    item.source_start,
    item.source_end,
    encode(digest(item.text, 'sha256'), 'hex')
  from jsonb_to_recordset(p_chunks) as item(
    chunk_index integer,
    text text,
    page_start integer,
    page_end integer,
    section_path text[],
    source_start integer,
    source_end integer
  );

  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    raise exception 'no chunks persisted';
  end if;

  update public.documents
  set status = 'ready',
      chunk_count = inserted_count,
      extraction_version = p_extraction_version,
      chunking_version = p_chunking_version,
      ingestion_error_code = null,
      ingestion_error_message = null,
      completed_at = now()
  where id = p_document_id and user_id = p_user_id;

  update public.ingestion_jobs
  set status = 'ready', finished_at = now()
  where document_id = p_document_id
    and user_id = p_user_id
    and status in ('queued', 'processing');

  return inserted_count;
end;
$$;

revoke execute on function public.persist_document_extraction(
  uuid, uuid, text, text, integer, integer, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_document_extraction(
  uuid, uuid, text, text, integer, integer, text, text, jsonb
) to service_role;

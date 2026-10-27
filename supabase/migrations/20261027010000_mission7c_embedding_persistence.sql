-- Mission 7C: embedding persistence only. No similarity index or retrieval RPC.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

do $$
declare
  extension_schema text;
begin
  select ns.nspname into extension_schema
  from pg_catalog.pg_extension ext
  join pg_catalog.pg_namespace ns on ns.oid = ext.extnamespace
  where ext.extname = 'pgcrypto';
  if extension_schema is null then
    raise exception 'pgcrypto extension is required';
  end if;
  if extension_schema <> 'extensions' then
    execute 'alter extension pgcrypto set schema extensions';
  end if;
end;
$$;

revoke create on schema extensions from public, anon, authenticated;
grant usage on schema extensions to authenticated, service_role;

alter function public.persist_document_extraction(uuid, uuid, text, text, integer, integer, text, text, jsonb)
  set search_path = pg_catalog, extensions;

alter table public.documents
  add constraint documents_id_user_id_unique unique (id, user_id);

alter table public.document_chunks
  add constraint document_chunks_id_document_user_unique unique (id, document_id, user_id);

create table public.document_embedding_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  user_id uuid not null,
  embedding_space text not null check (length(btrim(embedding_space)) between 1 and 200),
  embedding_model text not null check (length(btrim(embedding_model)) between 1 and 100),
  embedding_dimension integer not null check (embedding_dimension = 768),
  normalization_policy text not null check (normalization_policy = 'l2-unit-v1'),
  status text not null check (status in ('processing', 'ready', 'failed')),
  expected_part_count integer not null check (expected_part_count between 1 and 10000),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  claim_id uuid,
  attempt_count integer not null default 1 check (attempt_count > 0),
  lease_expires_at timestamptz,
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, embedding_space),
  unique (document_id, user_id, embedding_space),
  foreign key (document_id, user_id)
    references public.documents(id, user_id) on delete cascade,
  check ((status = 'processing') = (claim_id is not null)),
  check ((status = 'processing') = (lease_expires_at is not null)),
  check ((status = 'ready') = (finished_at is not null))
);

create index document_embedding_jobs_user_status_idx
  on public.document_embedding_jobs (user_id, status, updated_at desc);

create table public.document_embedding_job_parts (
  document_id uuid not null,
  user_id uuid not null,
  embedding_space text not null,
  source_chunk_id uuid not null,
  part_index integer not null check (part_index >= 0),
  source_content_hash text not null check (source_content_hash ~ '^[0-9a-f]{64}$'),
  input_content_hash text not null check (input_content_hash ~ '^[0-9a-f]{64}$'),
  input_text text not null check (length(btrim(input_text)) > 0),
  provider_input_text text not null check (length(btrim(provider_input_text)) > 0),
  source_start integer not null check (source_start >= 0),
  source_end integer not null check (source_end > source_start),
  created_at timestamptz not null default now(),
  primary key (document_id, embedding_space, source_chunk_id, part_index),
  foreign key (document_id, user_id, embedding_space)
    references public.document_embedding_jobs(document_id, user_id, embedding_space) on delete cascade,
  foreign key (source_chunk_id, document_id, user_id)
    references public.document_chunks(id, document_id, user_id) on delete cascade
);

create table public.document_chunk_embeddings (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  user_id uuid not null,
  source_chunk_id uuid not null,
  part_index integer not null check (part_index >= 0),
  embedding_model text not null check (length(btrim(embedding_model)) between 1 and 100),
  embedding_dimension integer not null check (embedding_dimension = 768),
  embedding_space text not null check (length(btrim(embedding_space)) between 1 and 200),
  normalization_policy text not null check (normalization_policy = 'l2-unit-v1'),
  source_content_hash text not null check (source_content_hash ~ '^[0-9a-f]{64}$'),
  input_content_hash text not null check (input_content_hash ~ '^[0-9a-f]{64}$'),
  input_text text not null check (length(btrim(input_text)) > 0),
  provider_input_text text not null check (length(btrim(provider_input_text)) > 0),
  source_start integer not null check (source_start >= 0),
  source_end integer not null check (source_end > source_start),
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_chunk_id, part_index, embedding_space),
  foreign key (document_id, user_id)
    references public.documents(id, user_id) on delete cascade,
  foreign key (source_chunk_id, document_id, user_id)
    references public.document_chunks(id, document_id, user_id) on delete cascade
);

create index document_chunk_embeddings_document_space_idx
  on public.document_chunk_embeddings (document_id, embedding_space, source_chunk_id, part_index);
create index document_chunk_embeddings_user_document_idx
  on public.document_chunk_embeddings (user_id, document_id);

alter table public.document_embedding_jobs enable row level security;
alter table public.document_embedding_job_parts enable row level security;
alter table public.document_chunk_embeddings enable row level security;

create policy "authenticated users read own embedding jobs"
  on public.document_embedding_jobs for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.document_embedding_jobs from anon, authenticated;
revoke all on public.document_embedding_job_parts from anon, authenticated;
revoke all on public.document_chunk_embeddings from anon, authenticated;
grant select on public.document_embedding_jobs to authenticated;

create trigger document_embedding_jobs_touch_updated_at
  before update on public.document_embedding_jobs
  for each row execute function public.touch_updated_at();
create trigger document_chunk_embeddings_touch_updated_at
  before update on public.document_chunk_embeddings
  for each row execute function public.touch_updated_at();

create or replace function public.claim_document_embedding_job(
  p_document_id uuid,
  p_user_id uuid,
  p_embedding_space text,
  p_embedding_model text,
  p_embedding_dimension integer,
  p_normalization_policy text,
  p_expected_part_count integer,
  p_manifest_hash text,
  p_manifest jsonb
)
returns table(job_status text, job_claim_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  current_job public.document_embedding_jobs%rowtype;
  new_claim uuid;
  is_new_job boolean;
begin
  if p_embedding_space is null or length(btrim(p_embedding_space)) not between 1 and 200
    or p_embedding_model is null or length(btrim(p_embedding_model)) not between 1 and 100
    or p_embedding_dimension is distinct from 768
    or p_normalization_policy is distinct from 'l2-unit-v1'
    or p_expected_part_count is null or p_expected_part_count not between 1 and 10000
    or p_manifest_hash is null or p_manifest_hash !~ '^[0-9a-f]{64}$'
    or p_manifest is null or jsonb_typeof(p_manifest) <> 'array'
    or jsonb_array_length(p_manifest) <> p_expected_part_count then
    raise exception 'invalid embedding job request';
  end if;

  perform 1 from public.documents
  where id = p_document_id and user_id = p_user_id and status = 'ready'
  for update;
  if not found then raise exception 'document is not owned or ready'; end if;

  insert into public.document_embedding_jobs (
    document_id, user_id, embedding_space, embedding_model, embedding_dimension,
    normalization_policy, status, expected_part_count,
    manifest_hash, claim_id, lease_expires_at
  ) values (
    p_document_id, p_user_id, p_embedding_space, p_embedding_model, p_embedding_dimension,
    p_normalization_policy, 'processing', p_expected_part_count,
    p_manifest_hash, gen_random_uuid(), now() + interval '30 minutes'
  )
  on conflict (document_id, embedding_space) do nothing
  returning * into current_job;
  is_new_job := found;
  if not is_new_job then
    select * into current_job
    from public.document_embedding_jobs
    where document_id = p_document_id and embedding_space = p_embedding_space
    for update;
  end if;

  if current_job.user_id <> p_user_id
    or current_job.embedding_model <> p_embedding_model
    or current_job.embedding_dimension <> p_embedding_dimension
    or current_job.normalization_policy <> p_normalization_policy
    or current_job.expected_part_count <> p_expected_part_count
    or current_job.manifest_hash <> p_manifest_hash then
    raise exception 'embedding manifest conflict; use a new embedding-space version';
  end if;

  insert into public.document_embedding_job_parts (
    document_id, user_id, embedding_space, source_chunk_id, part_index,
    source_content_hash, input_content_hash, input_text, provider_input_text,
    source_start, source_end
  )
  select
    p_document_id, p_user_id, p_embedding_space,
    item.source_chunk_id, item.part_index, item.source_content_hash,
    item.input_content_hash, item.input_text, item.provider_input_text,
    item.source_start, item.source_end
  from jsonb_to_recordset(p_manifest) as item(
    source_chunk_id uuid,
    part_index integer,
    source_content_hash text,
    input_content_hash text,
    input_text text,
    provider_input_text text,
    source_start integer,
    source_end integer
  )
  join public.document_chunks chunk
    on chunk.id = item.source_chunk_id
    and chunk.document_id = p_document_id
    and chunk.user_id = p_user_id
    and chunk.content_hash = item.source_content_hash
    and item.source_start >= chunk.source_start
    and item.source_end <= chunk.source_end
  where item.part_index >= 0
    and item.source_content_hash ~ '^[0-9a-f]{64}$'
    and item.input_content_hash = encode(extensions.digest(item.provider_input_text, 'sha256'), 'hex')
    and item.input_text is not null and length(btrim(item.input_text)) > 0
    and item.provider_input_text is not null and length(btrim(item.provider_input_text)) > 0
    and item.source_start >= 0 and item.source_end > item.source_start
  on conflict (document_id, embedding_space, source_chunk_id, part_index) do nothing;

  if (
    select count(*) from public.document_embedding_job_parts
    where document_id = p_document_id and embedding_space = p_embedding_space
  ) <> p_expected_part_count or exists (
    select 1 from jsonb_to_recordset(p_manifest) as item(
      source_chunk_id uuid,
      part_index integer,
      source_content_hash text,
      input_content_hash text,
      input_text text,
      provider_input_text text,
      source_start integer,
      source_end integer
    )
    left join public.document_embedding_job_parts stored
      on stored.document_id = p_document_id
      and stored.embedding_space = p_embedding_space
      and stored.source_chunk_id = item.source_chunk_id
      and stored.part_index = item.part_index
    where stored.source_chunk_id is null
      or stored.source_content_hash <> item.source_content_hash
      or stored.input_content_hash <> item.input_content_hash
      or stored.input_text <> item.input_text
      or stored.provider_input_text <> item.provider_input_text
      or stored.source_start <> item.source_start
      or stored.source_end <> item.source_end
  ) then
    raise exception 'embedding manifest does not match persisted parts';
  end if;
  if exists (
    select source_chunk_id
    from public.document_embedding_job_parts
    where document_id = p_document_id and embedding_space = p_embedding_space
    group by source_chunk_id
    having min(part_index) <> 0 or max(part_index) <> count(*) - 1
  ) then
    raise exception 'embedding part indexes must be contiguous from zero';
  end if;

  if current_job.status = 'ready' then
    return query select 'ready'::text, null::uuid;
    return;
  end if;
  if is_new_job then
    return query select 'claimed'::text, current_job.claim_id;
    return;
  end if;
  if current_job.status = 'processing' and current_job.lease_expires_at > now() then
    return query select 'processing'::text, null::uuid;
    return;
  end if;

  new_claim := gen_random_uuid();
  update public.document_embedding_jobs
  set status = 'processing',
      claim_id = new_claim,
      lease_expires_at = now() + interval '30 minutes',
      attempt_count = attempt_count + 1,
      error_code = null,
      started_at = now(),
      finished_at = null
  where id = current_job.id;
  return query select 'claimed'::text, new_claim;
end;
$$;

create or replace function public.persist_document_embedding_batch(
  p_document_id uuid,
  p_user_id uuid,
  p_embedding_space text,
  p_claim_id uuid,
  p_embeddings jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  current_job public.document_embedding_jobs%rowtype;
  inserted_count integer;
  payload_count integer;
begin
  if p_embeddings is null
    or jsonb_typeof(p_embeddings) <> 'array'
    or jsonb_array_length(p_embeddings) < 1
    or jsonb_array_length(p_embeddings) > 32 then
    raise exception 'invalid embedding batch';
  end if;

  perform 1 from public.documents
  where id = p_document_id and user_id = p_user_id and status = 'ready'
  for update;
  if not found then raise exception 'document is no longer ready'; end if;

  select * into current_job
  from public.document_embedding_jobs
  where document_id = p_document_id
    and user_id = p_user_id
    and embedding_space = p_embedding_space
  for update;
  if not found or current_job.status <> 'processing' or current_job.claim_id <> p_claim_id
    or current_job.lease_expires_at <= now() then
    raise exception 'embedding job claim is no longer active';
  end if;

  select count(*) into payload_count
  from jsonb_to_recordset(p_embeddings) as input(
    source_chunk_id uuid,
    part_index integer,
    embedding_model text,
    embedding_dimension integer,
    embedding_space text,
    normalization_policy text,
    source_content_hash text,
    input_content_hash text,
    input_text text,
    provider_input_text text,
    source_start integer,
    source_end integer,
    embedding text
  );

  if payload_count <> jsonb_array_length(p_embeddings) then
    raise exception 'invalid embedding payload';
  end if;

  insert into public.document_chunk_embeddings (
    document_id, user_id, source_chunk_id, part_index, embedding_model,
    embedding_dimension, embedding_space, normalization_policy,
    source_content_hash, input_content_hash, input_text, provider_input_text,
    source_start, source_end, embedding
  )
  select
    p_document_id,
    p_user_id,
    input.source_chunk_id,
    input.part_index,
    input.embedding_model,
    input.embedding_dimension,
    input.embedding_space,
    input.normalization_policy,
    input.source_content_hash,
    input.input_content_hash,
    input.input_text,
    input.provider_input_text,
    input.source_start,
    input.source_end,
    input.embedding::extensions.vector(768)
  from jsonb_to_recordset(p_embeddings) as input(
    source_chunk_id uuid,
    part_index integer,
    embedding_model text,
    embedding_dimension integer,
    embedding_space text,
    normalization_policy text,
    source_content_hash text,
    input_content_hash text,
    input_text text,
    provider_input_text text,
    source_start integer,
    source_end integer,
    embedding text
  )
  join public.document_chunks chunk
    on chunk.id = input.source_chunk_id
    and chunk.document_id = p_document_id
    and chunk.user_id = p_user_id
    and chunk.content_hash = input.source_content_hash
    and input.source_start >= chunk.source_start
    and input.source_end <= chunk.source_end
  join public.document_embedding_job_parts manifest
    on manifest.document_id = p_document_id
    and manifest.embedding_space = p_embedding_space
    and manifest.source_chunk_id = input.source_chunk_id
    and manifest.part_index = input.part_index
    and manifest.source_content_hash = input.source_content_hash
    and manifest.input_content_hash = input.input_content_hash
    and manifest.input_text = input.input_text
    and manifest.provider_input_text = input.provider_input_text
    and manifest.source_start = input.source_start
    and manifest.source_end = input.source_end
  where input.part_index >= 0
    and input.embedding_model is not null
    and input.embedding_dimension = 768
    and input.embedding_space = p_embedding_space
    and input.embedding_model = current_job.embedding_model
    and input.normalization_policy = current_job.normalization_policy
    and input.normalization_policy = 'l2-unit-v1'
    and input.input_text is not null and length(btrim(input.input_text)) > 0
    and input.provider_input_text is not null and length(btrim(input.provider_input_text)) > 0
    and input.source_content_hash ~ '^[0-9a-f]{64}$'
    and input.input_content_hash = encode(extensions.digest(input.provider_input_text, 'sha256'), 'hex')
    and input.source_start >= 0 and input.source_end > input.source_start
    and input.embedding is not null
    and abs(
      (-1 * (
        input.embedding::extensions.vector(768) <#> input.embedding::extensions.vector(768)
      )) - 1
    ) <= 0.00001
  on conflict (source_chunk_id, part_index, embedding_space) do nothing;
  get diagnostics inserted_count = row_count;

  if exists (
    select 1
    from jsonb_to_recordset(p_embeddings) as input(
      source_chunk_id uuid,
      part_index integer,
      embedding_model text,
      embedding_dimension integer,
      embedding_space text,
      normalization_policy text,
      source_content_hash text,
      input_content_hash text,
      input_text text,
      provider_input_text text,
      source_start integer,
      source_end integer,
      embedding text
    )
    left join public.document_chunk_embeddings stored
      on stored.source_chunk_id = input.source_chunk_id
      and stored.part_index = input.part_index
      and stored.embedding_space = input.embedding_space
    where stored.id is null
      or stored.document_id <> p_document_id
      or stored.user_id <> p_user_id
      or stored.embedding_model <> input.embedding_model
      or stored.embedding_dimension <> input.embedding_dimension
      or stored.normalization_policy <> input.normalization_policy
      or stored.source_content_hash <> input.source_content_hash
      or stored.input_content_hash <> input.input_content_hash
      or stored.input_text <> input.input_text
      or stored.provider_input_text <> input.provider_input_text
      or stored.source_start <> input.source_start
      or stored.source_end <> input.source_end
  ) then
    raise exception 'embedding identity conflicts with a persisted record';
  end if;

  update public.document_embedding_jobs
  set lease_expires_at = now() + interval '30 minutes'
  where id = current_job.id and claim_id = p_claim_id;

  return inserted_count;
end;
$$;

create or replace function public.finish_document_embedding_job(
  p_document_id uuid,
  p_user_id uuid,
  p_embedding_space text,
  p_claim_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_job public.document_embedding_jobs%rowtype;
  persisted_count integer;
begin
  perform 1 from public.documents
  where id = p_document_id and user_id = p_user_id and status = 'ready'
  for update;
  if not found then raise exception 'document is no longer ready'; end if;

  select * into current_job
  from public.document_embedding_jobs
  where document_id = p_document_id and user_id = p_user_id and embedding_space = p_embedding_space
  for update;
  if not found or current_job.status <> 'processing' or current_job.claim_id <> p_claim_id
    or current_job.lease_expires_at <= now() then
    raise exception 'embedding job claim is no longer active';
  end if;

  select count(*) into persisted_count
  from public.document_embedding_job_parts manifest
  join public.document_chunk_embeddings embedding
    on embedding.document_id = manifest.document_id
    and embedding.user_id = manifest.user_id
    and embedding.embedding_space = manifest.embedding_space
    and embedding.source_chunk_id = manifest.source_chunk_id
    and embedding.part_index = manifest.part_index
    and embedding.source_content_hash = manifest.source_content_hash
    and embedding.input_content_hash = manifest.input_content_hash
  where manifest.document_id = p_document_id and manifest.user_id = p_user_id
    and manifest.embedding_space = p_embedding_space;
  if persisted_count <> current_job.expected_part_count then
    raise exception 'embedding job has incomplete persistence';
  end if;

  update public.document_embedding_jobs
  set status = 'ready', claim_id = null, lease_expires_at = null,
      error_code = null, finished_at = now()
  where id = current_job.id;
  return true;
end;
$$;

create or replace function public.fail_document_embedding_job(
  p_document_id uuid,
  p_user_id uuid,
  p_embedding_space text,
  p_claim_id uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.document_embedding_jobs
  set status = 'failed', claim_id = null, lease_expires_at = null,
      error_code = case when p_error_code ~ '^[A-Z0-9_]{1,64}$' then p_error_code else 'EMBEDDING_FAILED' end
  where document_id = p_document_id and user_id = p_user_id
    and embedding_space = p_embedding_space and status = 'processing'
    and claim_id = p_claim_id;
  return found;
end;
$$;

revoke all on function public.claim_document_embedding_job(uuid, uuid, text, text, integer, text, integer, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.persist_document_embedding_batch(uuid, uuid, text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.finish_document_embedding_job(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_document_embedding_job(uuid, uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_document_embedding_job(uuid, uuid, text, text, integer, text, integer, text, jsonb) to service_role;
grant execute on function public.persist_document_embedding_batch(uuid, uuid, text, uuid, jsonb) to service_role;
grant execute on function public.finish_document_embedding_job(uuid, uuid, text, uuid) to service_role;
grant execute on function public.fail_document_embedding_job(uuid, uuid, text, uuid, text) to service_role;

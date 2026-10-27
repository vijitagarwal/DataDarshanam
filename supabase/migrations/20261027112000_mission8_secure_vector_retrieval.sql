-- Mission 8: authenticated, owner-filtered vector retrieval.
-- No answer generation, threshold, or vector index is introduced here.

create schema if not exists extensions;

do $$
declare
  extension_schema text;
begin
  select ns.nspname into extension_schema
  from pg_catalog.pg_extension ext
  join pg_catalog.pg_namespace ns on ns.oid = ext.extnamespace
  where ext.extname = 'pgcrypto';
  if extension_schema is null then
    raise exception 'pgcrypto extension is required before Mission 8';
  end if;
  if extension_schema <> 'extensions' then
    execute 'alter extension pgcrypto set schema extensions';
  end if;
end;
$$;

revoke create on schema extensions from public, anon, authenticated;
grant usage on schema extensions to authenticated, service_role;

-- Existing definer functions use pgcrypto's digest function. Keep untrusted
-- schemas out of name resolution and pin digest to the controlled extension.
alter function public.persist_document_extraction(uuid, uuid, text, text, integer, integer, text, text, jsonb)
  set search_path = pg_catalog, extensions;
alter function public.claim_document_embedding_job(uuid, uuid, text, text, integer, text, integer, text, jsonb)
  set search_path = pg_catalog, extensions;
alter function public.persist_document_embedding_batch(uuid, uuid, text, uuid, jsonb)
  set search_path = pg_catalog, extensions;
alter function public.finish_document_embedding_job(uuid, uuid, text, uuid)
  set search_path = pg_catalog;
alter function public.fail_document_embedding_job(uuid, uuid, text, uuid, text)
  set search_path = pg_catalog;

create or replace function public.retrieve_document_chunks(
  p_embedding_space text,
  p_embedding_model text,
  p_embedding_dimension integer,
  p_normalization_policy text,
  p_query_embedding extensions.vector(768),
  p_document_ids uuid[] default null,
  p_result_limit integer default 5
)
returns table (
  document_id uuid,
  document_name text,
  chunk_id uuid,
  chunk_index integer,
  text_content text,
  source_start integer,
  source_end integer,
  page_start integer,
  page_end integer,
  section_path text[],
  similarity real
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  requesting_user uuid := auth.uid();
  query_norm_squared double precision;
begin
  if requesting_user is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;
  if p_embedding_space is null or length(btrim(p_embedding_space)) not between 1 and 200
    or p_embedding_model is distinct from 'gemini-embedding-001'
    or p_embedding_dimension is distinct from 768
    or p_normalization_policy is distinct from 'l2-unit-v1'
    or p_query_embedding is null
    or p_result_limit is null or p_result_limit not between 1 and 20
    or (p_document_ids is not null and (
      cardinality(p_document_ids) > 50
      or array_position(p_document_ids, null::uuid) is not null
    )) then
    raise exception using errcode = '22023', message = 'invalid retrieval request';
  end if;

  query_norm_squared := -1 * (
    p_query_embedding OPERATOR(extensions.<#>) p_query_embedding
  );
  if query_norm_squared is null or abs(query_norm_squared - 1) > 0.00001 then
    raise exception using errcode = '22023', message = 'query vector must be unit normalized';
  end if;

  return query
  with matching_parts as (
    select
      document.id as found_document_id,
      document.display_name as found_document_name,
      chunk.id as found_chunk_id,
      chunk.chunk_index as found_chunk_index,
      chunk.text_content as found_text_content,
      chunk.source_start as found_source_start,
      chunk.source_end as found_source_end,
      chunk.page_start as found_page_start,
      chunk.page_end as found_page_end,
      chunk.section_path as found_section_path,
      (
        1::real - (
          embedding.embedding OPERATOR(extensions.<=>) p_query_embedding
        )
      ) as found_similarity
    from public.document_chunk_embeddings embedding
    join public.document_embedding_jobs job
      on job.document_id = embedding.document_id
      and job.user_id = embedding.user_id
      and job.embedding_space = embedding.embedding_space
      and job.status = 'ready'
    join public.documents document
      on document.id = embedding.document_id
      and document.user_id = embedding.user_id
      and document.status = 'ready'
    join public.document_chunks chunk
      on chunk.id = embedding.source_chunk_id
      and chunk.document_id = embedding.document_id
      and chunk.user_id = embedding.user_id
      and chunk.content_hash = embedding.source_content_hash
      and embedding.source_start >= chunk.source_start
      and embedding.source_end <= chunk.source_end
    where embedding.user_id = requesting_user
      and embedding.embedding_space = p_embedding_space
      and embedding.embedding_model = p_embedding_model
      and embedding.embedding_dimension = p_embedding_dimension
      and embedding.normalization_policy = p_normalization_policy
      and job.embedding_model = p_embedding_model
      and job.embedding_dimension = p_embedding_dimension
      and job.normalization_policy = p_normalization_policy
      and (p_document_ids is null or document.id = any(p_document_ids))
  ),
  ranked_chunks as (
    select
      matching_parts.found_document_id,
      matching_parts.found_document_name,
      matching_parts.found_chunk_id,
      matching_parts.found_chunk_index,
      matching_parts.found_text_content,
      matching_parts.found_source_start,
      matching_parts.found_source_end,
      matching_parts.found_page_start,
      matching_parts.found_page_end,
      matching_parts.found_section_path,
      max(matching_parts.found_similarity) as best_similarity
    from matching_parts
    group by
      matching_parts.found_document_id,
      matching_parts.found_document_name,
      matching_parts.found_chunk_id,
      matching_parts.found_chunk_index,
      matching_parts.found_text_content,
      matching_parts.found_source_start,
      matching_parts.found_source_end,
      matching_parts.found_page_start,
      matching_parts.found_page_end,
      matching_parts.found_section_path
  )
  select
    ranked_chunks.found_document_id,
    ranked_chunks.found_document_name,
    ranked_chunks.found_chunk_id,
    ranked_chunks.found_chunk_index,
    ranked_chunks.found_text_content,
    ranked_chunks.found_source_start,
    ranked_chunks.found_source_end,
    ranked_chunks.found_page_start,
    ranked_chunks.found_page_end,
    ranked_chunks.found_section_path,
    ranked_chunks.best_similarity
  from ranked_chunks
  order by ranked_chunks.best_similarity desc,
    ranked_chunks.found_document_id,
    ranked_chunks.found_chunk_index
  limit p_result_limit;
end;
$$;

alter function public.retrieve_document_chunks(
  text, text, integer, text, extensions.vector, uuid[], integer
) owner to postgres;
revoke all on function public.retrieve_document_chunks(
  text, text, integer, text, extensions.vector, uuid[], integer
) from public, anon;
grant execute on function public.retrieve_document_chunks(
  text, text, integer, text, extensions.vector, uuid[], integer
) to authenticated;

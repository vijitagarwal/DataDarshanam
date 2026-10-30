-- Mission 10: authenticated, durable, user-owned CSV datasets.

create table public.datasets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  original_filename text not null check (length(btrim(original_filename)) between 1 and 255),
  storage_bucket text not null default 'datasets' check (storage_bucket = 'datasets'),
  storage_path text not null unique,
  file_size bigint not null check (file_size between 1 and 26214400),
  row_count integer not null default 0 check (row_count between 0 and 250000),
  column_count integer not null default 0 check (column_count between 0 and 100),
  schema jsonb not null default '{}'::jsonb check (jsonb_typeof(schema) = 'object'),
  status text not null default 'uploading'
    check (status in ('uploading', 'ready', 'failed', 'deleting')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (storage_path = user_id::text || '/' || id::text || '.csv'),
  check (
    status <> 'ready'
    or (row_count > 0 and column_count > 0 and completed_at is not null)
  )
);

create index datasets_user_created_idx
  on public.datasets (user_id, created_at desc);
create index datasets_user_status_idx
  on public.datasets (user_id, status);

create or replace function public.touch_dataset_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger datasets_touch_updated_at
before update on public.datasets
for each row execute function public.touch_dataset_updated_at();

create or replace function public.prevent_dataset_identity_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.user_id <> old.user_id
    or new.storage_bucket <> old.storage_bucket
    or new.storage_path <> old.storage_path then
    raise exception 'dataset ownership and storage identity are immutable';
  end if;
  return new;
end;
$$;

create trigger datasets_identity_immutable
before update on public.datasets
for each row execute function public.prevent_dataset_identity_change();

create or replace function public.prevent_invalid_dataset_transition()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.status <> old.status and not (
    (old.status = 'uploading' and new.status in ('ready', 'failed', 'deleting'))
    or (old.status = 'ready' and new.status = 'deleting')
    or (old.status = 'deleting' and new.status in ('ready', 'failed'))
    or (old.status = 'failed' and new.status = 'deleting')
  ) then
    raise exception 'invalid dataset status transition';
  end if;
  return new;
end;
$$;

create trigger datasets_valid_status_transition
before update on public.datasets
for each row execute function public.prevent_invalid_dataset_transition();

alter table public.datasets enable row level security;

create policy "authenticated users read own datasets"
on public.datasets for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.datasets from public, anon, authenticated;
grant select on public.datasets to authenticated;
grant select, insert, update, delete on public.datasets to service_role;

-- Only the server API uses the service role to create a quota-checked reservation.
create or replace function public.reserve_user_dataset(
  p_dataset_id uuid,
  p_user_id uuid,
  p_original_filename text,
  p_storage_path text,
  p_file_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  active_count bigint;
  active_bytes bigint;
begin
  if p_dataset_id is null
    or p_user_id is null
    or p_original_filename is null
    or length(btrim(p_original_filename)) not between 1 and 255
    or p_file_size is null or p_file_size not between 1 and 26214400
    or p_storage_path is distinct from p_user_id::text || '/' || p_dataset_id::text || '.csv' then
    raise exception using errcode = '22023', message = 'invalid dataset reservation';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0::bigint)
  );

  select count(*), coalesce(sum(file_size), 0)
    into active_count, active_bytes
  from public.datasets
  where user_id = p_user_id
    and status in ('uploading', 'ready', 'deleting');

  if active_count >= 10 or active_bytes + p_file_size > 209715200 then
    raise exception using errcode = '54000', message = 'dataset quota exceeded';
  end if;

  insert into public.datasets (
    id, user_id, original_filename, storage_path, file_size
  ) values (
    p_dataset_id, p_user_id, btrim(p_original_filename), p_storage_path, p_file_size
  );

  return p_dataset_id;
end;
$$;

revoke all on function public.reserve_user_dataset(uuid, uuid, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.reserve_user_dataset(uuid, uuid, text, text, bigint)
  to service_role;

-- The bucket is private. Server routes perform writes after verifying the user;
-- direct authenticated reads are restricted to the owner's UUID prefix.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('datasets', 'datasets', false, 26214400, array['text/csv'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "users read own dataset objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'datasets'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

-- Run in Supabase SQL Editor. Safe to rerun; does not delete data.
create table if not exists public.gradebook_documents (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision uuid not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  constraint payload_size check (octet_length(payload::text) <= 5242880),
  constraint payload_shape check (payload->>'version' = '4' and jsonb_typeof(payload->'schools') = 'array')
);
alter table public.gradebook_documents enable row level security;
revoke all on public.gradebook_documents from anon, authenticated;
grant select, insert, update on public.gradebook_documents to authenticated;
drop policy if exists own_document on public.gradebook_documents;
create policy own_document on public.gradebook_documents for all to authenticated
using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

-- Compare-and-swap protects against another device overwriting a newer revision.
-- SECURITY INVOKER: all reads/writes also pass the RLS policy above.
create or replace function public.save_gradebook(expected_revision uuid, new_revision uuid, document jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare result uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if new_revision is null then raise exception 'INVALID_REVISION'; end if;
  if expected_revision is null then
    insert into public.gradebook_documents(owner_id, revision, payload)
    values(auth.uid(), new_revision, document) on conflict do nothing
    returning revision into result;
  else
    update public.gradebook_documents set payload = document, revision = new_revision, updated_at = now()
    where owner_id = auth.uid() and revision = expected_revision
    returning revision into result;
  end if;
  if result is null then
    select revision into result from public.gradebook_documents
    where owner_id = auth.uid() and revision = new_revision;
  end if;
  if result is null then raise exception 'REVISION_CONFLICT'; end if;
  return result;
end;
$$;
revoke all on function public.save_gradebook(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_gradebook(uuid, uuid, jsonb) to authenticated;

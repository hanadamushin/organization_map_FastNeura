-- Run once in the Supabase SQL Editor as the project administrator.
-- No real member names, email addresses or organization JSON belong in Git.
begin;
create table if not exists public.organization_documents (
  id text primary key,
  document jsonb not null default '{"version":1,"members":[]}'::jsonb,
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create table if not exists public.organization_access (
  organization_id text not null references public.organization_documents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (organization_id,user_id)
);
alter table public.organization_documents enable row level security;
alter table public.organization_access enable row level security;
revoke all on public.organization_documents,public.organization_access from public,anon,authenticated;
grant select on public.organization_documents,public.organization_access to authenticated;
drop policy if exists "read own membership" on public.organization_access;
create policy "read own membership" on public.organization_access for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "members read organization" on public.organization_documents;
create policy "members read organization" on public.organization_documents for select to authenticated using (
  exists(select 1 from public.organization_access a where a.organization_id = organization_documents.id and a.user_id = (select auth.uid()))
);

-- Validated on the server too: bypassing the UI cannot create broken trees.
create or replace function public.validate_organization_document(p_document jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  items jsonb; item jsonb; node_id text; parent_id text; nodes jsonb := '{}'::jsonb; seen text[];
begin
  if p_document is null or jsonb_typeof(p_document) <> 'object' or p_document->'version' is distinct from '1'::jsonb then return false; end if;
  items := p_document->'members';
  if items is null or jsonb_typeof(items) <> 'array' then return false; end if;
  if jsonb_array_length(items) > 500 or octet_length(p_document::text) > 2097152 then return false; end if;
  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'id') is distinct from 'string'
      or jsonb_typeof(item->'name') is distinct from 'string' or jsonb_typeof(item->'role') is distinct from 'string'
      or not (item ? 'parentId') or jsonb_typeof(item->'parentId') not in ('string','null') then return false; end if;
    node_id := item->>'id';
    if length(node_id) = 0 or length(node_id) > 200 or nodes ? node_id
      or length(btrim(item->>'name')) not between 1 and 80
      or length(btrim(item->>'role')) not between 1 and 80 then return false; end if;
    nodes := nodes || jsonb_build_object(node_id,item);
  end loop;
  for item in select value from jsonb_array_elements(items) loop
    seen := array[item->>'id']; parent_id := item->>'parentId';
    while parent_id is not null loop
      if not (nodes ? parent_id) or parent_id = any(seen) then return false; end if;
      seen := array_append(seen,parent_id); parent_id := nodes->parent_id->>'parentId';
    end loop;
  end loop;
  return true;
end;
$$;
revoke all on function public.validate_organization_document(jsonb) from public,anon,authenticated;

-- Only this function may write. Its membership check cannot be skipped by a client.
-- Row locking + expected revision prevent silent overwrite by another browser.
create or replace function public.save_organization_document(p_id text,p_document jsonb,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_revision integer; result jsonb;
begin
  if auth.uid() is null then raise exception 'ACCESS_DENIED' using errcode = '42501'; end if;
  perform 1 from public.organization_access where organization_id = p_id and user_id = auth.uid() for share;
  if not found then raise exception 'ACCESS_DENIED' using errcode = '42501'; end if;
  if not public.validate_organization_document(p_document) then raise exception 'INVALID_DOCUMENT' using errcode = '22023'; end if;
  select revision into current_revision from public.organization_documents where id = p_id for update;
  if not found then raise exception 'ACCESS_DENIED' using errcode = '42501'; end if;
  if current_revision is distinct from p_expected_revision then raise exception 'VERSION_CONFLICT' using errcode = '40001'; end if;
  update public.organization_documents set document = p_document,revision = current_revision + 1,updated_at = now(),updated_by = auth.uid() where id = p_id
    returning jsonb_build_object('document',document,'revision',revision,'updated_at',updated_at) into result;
  return result;
end;
$$;
revoke all on function public.save_organization_document(text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.save_organization_document(text,jsonb,integer) to authenticated;
insert into public.organization_documents(id) values ('fastneura') on conflict (id) do nothing;
commit;

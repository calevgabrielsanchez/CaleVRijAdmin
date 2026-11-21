-- Global, shared project-library dataset. The app intentionally exposes this
-- data to every client using the publishable key; do not put private data here.
create table if not exists public.calevrij_library_nodes (
  id uuid primary key,
  parent_id uuid null,
  name text not null,
  data jsonb not null default '{"files":[],"children":[]}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists calevrij_library_nodes_parent_id_idx
  on public.calevrij_library_nodes (parent_id);
create index if not exists calevrij_library_nodes_updated_at_idx
  on public.calevrij_library_nodes (updated_at desc);

grant select, insert, update on public.calevrij_library_nodes to anon, authenticated;

alter table public.calevrij_library_nodes enable row level security;

drop policy if exists "Anyone can read shared library" on public.calevrij_library_nodes;
create policy "Anyone can read shared library"
  on public.calevrij_library_nodes for select to anon, authenticated using (true);

drop policy if exists "Anyone can add shared library data" on public.calevrij_library_nodes;
create policy "Anyone can add shared library data"
  on public.calevrij_library_nodes for insert to anon, authenticated with check (true);

drop policy if exists "Anyone can update shared library data" on public.calevrij_library_nodes;
create policy "Anyone can update shared library data"
  on public.calevrij_library_nodes for update to anon, authenticated using (true) with check (true);

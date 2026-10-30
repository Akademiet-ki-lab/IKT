-- Helpnotes: saksnotater i Supabase
-- Kjør hele skriptet i Supabase → SQL Editor → Run.

create table if not exists public.helpnotes_tickets (
  id          text primary key,
  number      text        not null,
  technician  text        not null default '',
  user_name   text        not null default '',
  room        text        not null default '',
  equipment   text        not null default '',
  serial      text        not null default '',
  loan_id     text        not null default '',
  category    text        not null default '#Annet',
  priority    text        not null default 'Middels',
  symptom     text        not null default '',
  cause       text        not null default '',
  action      text        not null default '',
  shift_notes text        not null default '',
  status      text        not null default 'Venter på deler/bruker',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists helpnotes_tickets_updated_at_idx on public.helpnotes_tickets (updated_at desc);
create index if not exists helpnotes_tickets_number_idx on public.helpnotes_tickets (number);

-- Sikkerhet: appen bruker publishable/anon-nøkkelen og er beskyttet av passordveggen i appen.
-- Alle med nøkkelen kan lese og skrive saker (ingen sletting; slettede saker får deleted_at).
alter table public.helpnotes_tickets enable row level security;

drop policy if exists "helpnotes_tickets_select" on public.helpnotes_tickets;
drop policy if exists "helpnotes_tickets_insert" on public.helpnotes_tickets;
drop policy if exists "helpnotes_tickets_update" on public.helpnotes_tickets;
create policy "helpnotes_tickets_select" on public.helpnotes_tickets for select to anon, authenticated using (true);
create policy "helpnotes_tickets_insert" on public.helpnotes_tickets for insert to anon, authenticated with check (true);
create policy "helpnotes_tickets_update" on public.helpnotes_tickets for update to anon, authenticated using (true) with check (true);

grant select, insert, update on public.helpnotes_tickets to anon, authenticated;

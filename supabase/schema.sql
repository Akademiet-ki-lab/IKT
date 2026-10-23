-- IKT-pulten: saksnotater i Supabase
-- Kjør hele skriptet i Supabase → SQL Editor → Run.

create table if not exists public.tickets (
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

create index if not exists tickets_updated_at_idx on public.tickets (updated_at desc);
create index if not exists tickets_number_idx on public.tickets (number);

-- Sikkerhet: bare innloggede brukere får lese og skrive.
alter table public.tickets enable row level security;

drop policy if exists "tickets_select" on public.tickets;
drop policy if exists "tickets_insert" on public.tickets;
drop policy if exists "tickets_update" on public.tickets;
create policy "tickets_select" on public.tickets for select to authenticated using (true);
create policy "tickets_insert" on public.tickets for insert to authenticated with check (true);
create policy "tickets_update" on public.tickets for update to authenticated using (true) with check (true);

grant select, insert, update on public.tickets to authenticated;

-- Opprett en bruker under Authentication → Users → Add user (kryss av "Auto Confirm User").
-- Logg deretter inn i IKT-pulten under Lagring.
--
-- RASK TESTING UTEN INNLOGGING (kun for testdata, aldri elevdata):
--   bytt "to authenticated" med "to anon, authenticated" i policyene over
--   og kjør: grant select, insert, update on public.tickets to anon;

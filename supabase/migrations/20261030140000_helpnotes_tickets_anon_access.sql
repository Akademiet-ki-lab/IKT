-- Helpnotes: appen bruker anon-nøkkelen og passordveggen i stedet for Supabase-innlogging.
drop policy if exists "helpnotes_tickets_select" on public.helpnotes_tickets;
drop policy if exists "helpnotes_tickets_insert" on public.helpnotes_tickets;
drop policy if exists "helpnotes_tickets_update" on public.helpnotes_tickets;
create policy "helpnotes_tickets_select" on public.helpnotes_tickets for select to anon, authenticated using (true);
create policy "helpnotes_tickets_insert" on public.helpnotes_tickets for insert to anon, authenticated with check (true);
create policy "helpnotes_tickets_update" on public.helpnotes_tickets for update to anon, authenticated using (true) with check (true);

grant select, insert, update on public.helpnotes_tickets to anon, authenticated;

-- Append-only visit notes shared by the two authorized owners.
create table public.customer_visit_notes (
 id uuid primary key default gen_random_uuid(),
 store_name text not null references public.stores(store_name),
 note text not null check(length(btrim(note)) between 1 and 2000),
 recorded_by uuid not null default auth.uid(),
 recorded_by_email text,
 created_at timestamptz not null default now()
);
create index customer_visit_notes_store_idx on public.customer_visit_notes(store_name,created_at desc);
alter table public.customer_visit_notes enable row level security;
revoke all on public.customer_visit_notes from public,anon,authenticated;
grant select,insert on public.customer_visit_notes to authenticated;
create policy owners_read_visit_notes on public.customer_visit_notes for select to authenticated using ((select public.is_owner()));
create policy owners_add_visit_notes on public.customer_visit_notes for insert to authenticated with check ((select public.is_owner()) and recorded_by=(select auth.uid()));
create function public.stamp_visit_note() returns trigger language plpgsql security invoker set search_path='' as $$ begin
 if not public.is_owner() then raise exception 'Owner access required'; end if;
 new.recorded_by:=auth.uid();new.recorded_by_email:=auth.jwt()->>'email';new.created_at:=now();new.note:=btrim(new.note);return new;
end $$;
revoke all on function public.stamp_visit_note() from public,anon,authenticated;
create trigger stamp_visit_note before insert on public.customer_visit_notes for each row execute function public.stamp_visit_note();

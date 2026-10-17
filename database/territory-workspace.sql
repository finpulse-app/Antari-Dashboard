-- Shared territory tools. Financial report tables remain the source of truth.
create table public.territory_prospects (
 id uuid primary key default gen_random_uuid(),
 business_name text not null check(length(btrim(business_name)) between 1 and 160),
 zip text not null check(zip ~ '^[0-9]{5}$'),
 category text not null default '' check(length(category)<=80),
 address text not null default '' check(length(address)<=300),
 contact text not null default '' check(length(contact)<=250),
 stage text not null default 'identified' check(stage in ('identified','contacted','sampled','first_order','repeat_buyer','paused')),
 notes text not null default '' check(length(notes)<=2000),
 next_step text not null default '' check(length(next_step)<=200),
 follow_up_on date,
 sampling_cost numeric(12,2) not null default 0 check(sampling_cost>=0 and sampling_cost<1000000000),
 linked_store text references public.stores(store_name),
 archived boolean not null default false,
 revision integer not null default 1,
 created_by uuid not null default auth.uid(), created_at timestamptz not null default now(),
 updated_by uuid not null default auth.uid(), updated_by_email text, updated_at timestamptz not null default now()
);
create unique index territory_prospects_identity on public.territory_prospects(lower(btrim(business_name)),zip);
create index territory_prospects_linked_store on public.territory_prospects(linked_store);
create index territory_prospects_zip on public.territory_prospects(zip);

create table public.customer_followups (
 id uuid primary key default gen_random_uuid(),
 store_name text not null references public.stores(store_name),
 title text not null check(length(btrim(title)) between 1 and 200),
 due_on date not null,
 kind text not null default 'visit' check(kind in ('visit','product','collection','other')),
 notes text not null default '' check(length(notes)<=2000),
 completed boolean not null default false,
 revision integer not null default 1,
 created_by uuid not null default auth.uid(), created_at timestamptz not null default now(),
 updated_by uuid not null default auth.uid(), updated_by_email text, updated_at timestamptz not null default now()
);
create index customer_followups_store on public.customer_followups(store_name,due_on);

create table public.territory_scenarios (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(btrim(title)) between 1 and 160),
 zip text check(zip ~ '^[0-9]{5}$'),
 customers integer not null check(customers between 1 and 10000),
 order_value numeric(12,2) not null check(order_value>0 and order_value<1000000000),
 orders_per_month numeric(8,2) not null check(orders_per_month>0 and orders_per_month<=100),
 margin_pct numeric(5,2) not null check(margin_pct between 0 and 100),
 monthly_cost numeric(12,2) not null check(monthly_cost>=0 and monthly_cost<1000000000),
 archived boolean not null default false,
 revision integer not null default 1,
 created_by uuid not null default auth.uid(), created_at timestamptz not null default now(),
 updated_by uuid not null default auth.uid(), updated_by_email text, updated_at timestamptz not null default now()
);

create table public.territory_initiatives (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(btrim(title)) between 1 and 160),
 zip text not null check(zip ~ '^[0-9]{5}$'),
 hypothesis text not null check(length(btrim(hypothesis)) between 1 and 2000),
 starts_on date not null, review_on date not null check(review_on>=starts_on),
 success_measure text not null check(length(btrim(success_measure)) between 1 and 300),
 outcome text not null default '' check(length(outcome)<=2000),
 status text not null default 'active' check(status in ('active','complete','paused')),
 revision integer not null default 1,
 created_by uuid not null default auth.uid(), created_at timestamptz not null default now(),
 updated_by uuid not null default auth.uid(), updated_by_email text, updated_at timestamptz not null default now()
);
create index territory_initiatives_zip on public.territory_initiatives(zip);

-- Invoker trigger stamps authors and preserves immutable identity.
create function public.stamp_territory_record() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not public.is_owner() then raise exception 'Owner access required'; end if;
 if tg_op='INSERT' then
  new.created_by:=auth.uid();new.created_at:=now();new.revision:=1;
 else
  if new.id<>old.id then raise exception 'Record identity cannot change'; end if;
  new.created_by:=old.created_by;new.created_at:=old.created_at;new.revision:=old.revision+1;
 end if;
 new.updated_by:=auth.uid();new.updated_by_email:=auth.jwt()->>'email';new.updated_at:=now();
 return new;
end $$;
revoke all on function public.stamp_territory_record() from public,anon,authenticated;

do $$ declare t text; begin
 foreach t in array array['territory_prospects','customer_followups','territory_scenarios','territory_initiatives'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update on public.%I to authenticated',t);
  execute format('create policy owners_read on public.%I for select to authenticated using ((select public.is_owner()))',t);
  execute format('create policy owners_insert on public.%I for insert to authenticated with check ((select public.is_owner()) and created_by=(select auth.uid()) and updated_by=(select auth.uid()))',t);
  execute format('create policy owners_update on public.%I for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()) and updated_by=(select auth.uid()))',t);
  execute format('create trigger stamp_territory_record before insert or update on public.%I for each row execute function public.stamp_territory_record()',t);
 end loop;
end $$;

-- Structured information extracted from a visit note is an unposted field draft.
-- It never feeds the financial views used for imported sales totals.
alter table public.customer_visit_notes
 add column activity_kind text not null default 'note' check(activity_kind in ('note','sale_draft')),
 add column product text check(length(product)<=160),
 add column quantity numeric(12,3) check(quantity>0 and quantity<1000000000),
 add column quantity_unit text check(length(quantity_unit)<=30),
 add column discount_pct numeric(5,2) check(discount_pct between 0 and 100),
 add column discount_reason text check(length(discount_reason)<=160),
 add column unit_price numeric(12,2) check(unit_price>=0 and unit_price<1000000000),
 add column sale_on date,
 add constraint sale_draft_has_details check(activity_kind<>'sale_draft' or (product is not null and length(btrim(product))>0 and quantity is not null));

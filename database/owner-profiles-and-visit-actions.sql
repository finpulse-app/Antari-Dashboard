-- Additive owner tools. No report amounts or historical customer mappings are changed.
create table public.customer_profiles (
 id uuid primary key default gen_random_uuid(),
 store_name text not null unique references public.stores(store_name),
 address text not null default '' check(length(address)<=300),
 phone text not null default '' check(length(phone)<=80),
 email text not null default '' check(length(email)<=200),
 preferred_contact text not null default '' check(preferred_contact in ('','phone','text','email','in_person')),
 interests text not null default '' check(length(interests)<=1000),
 zoho_organization_id text not null default '' check(length(zoho_organization_id)<=100),
 zoho_contact_id text not null default '' check(length(zoho_contact_id)<=100),
 square_customer_id text not null default '' check(length(square_customer_id)<=200),
 address_confirmed boolean not null default false,
 revision integer not null default 1,
 created_by uuid default auth.uid(),created_at timestamptz not null default now(),
 updated_by uuid default auth.uid(),updated_by_email text,updated_at timestamptz not null default now(),
 check(not address_confirmed or length(btrim(address))>0),
 check(zoho_contact_id='' or zoho_organization_id<>'')
);
create unique index customer_profiles_zoho_identity on public.customer_profiles(zoho_organization_id,zoho_contact_id) where zoho_contact_id<>'';
create unique index customer_profiles_square_identity on public.customer_profiles(square_customer_id) where square_customer_id<>'';
-- System backfill has no invented owner attribution. Subsequent edits are stamped.
insert into public.customer_profiles(store_name) select store_name from public.stores where store_name<>'Other';

create table public.product_unit_pricing (
 id uuid primary key default gen_random_uuid(),
 item_name text not null unique check(length(btrim(item_name)) between 1 and 200),
 sku text not null default '' check(length(sku)<=100),
 unit_cost numeric(12,2) not null check(unit_cost>=0 and unit_cost<1000000000),
 wholesale_price numeric(12,2) not null check(wholesale_price>0 and wholesale_price<1000000000),
 unit_basis text not null default 'individual' check(unit_basis='individual'),
 notes text not null default '' check(length(notes)<=1000),
 revision integer not null default 1,
 created_by uuid not null default auth.uid(),created_at timestamptz not null default now(),
 updated_by uuid not null default auth.uid(),updated_by_email text,updated_at timestamptz not null default now()
);
create unique index product_unit_pricing_sku on public.product_unit_pricing(sku) where sku<>'';
do $$ declare t text; begin
 foreach t in array array['customer_profiles','product_unit_pricing'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update on public.%I to authenticated',t);
  execute format('create policy owners_read on public.%I for select to authenticated using ((select public.is_owner()))',t);
  execute format('create policy owners_insert on public.%I for insert to authenticated with check ((select public.is_owner()) and updated_by=(select auth.uid()))',t);
  execute format('create policy owners_update on public.%I for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()) and updated_by=(select auth.uid()))',t);
  execute format('create trigger stamp_territory_record before insert or update on public.%I for each row execute function public.stamp_territory_record()',t);
 end loop;
end $$;

create function public.ensure_customer_profile() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.store_name<>old.store_name then raise exception 'A location identity cannot be reassigned';end if;
 else
  if new.store_name<>'Other' then insert into public.customer_profiles(store_name) values(new.store_name);end if;
 end if;
 return new;
end $$;
revoke all on function public.ensure_customer_profile() from public,anon,authenticated;
create trigger ensure_customer_profile after insert on public.stores for each row execute function public.ensure_customer_profile();
create trigger preserve_profile_identity before update on public.customer_profiles for each row execute function public.ensure_customer_profile();

create function public.save_customer_profile(p_store text,p_expected_revision integer,p_data jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare row public.customer_profiles; profile_id uuid;
begin
 if not public.is_owner() then raise exception 'Owner access required';end if;
 -- The shared profile is the revision lock for all metadata edits through this action.
 perform 1 from public.stores where store_name=p_store for update;
 if not found then raise exception 'Customer no longer exists';end if;
 select * into row from public.customer_profiles where store_name=p_store for update;
 if (row.id is null and p_expected_revision<>0) or (row.id is not null and row.revision<>p_expected_revision) then raise exception 'This profile changed. Refresh before editing again.';end if;
 if coalesce(p_data->>'zip','')!~'^[0-9]{5}$' then raise exception 'Enter a five-digit ZIP';end if;
 if length(coalesce(p_data->>'category',''))>80 or length(coalesce(p_data->>'contact_name',''))>200 then raise exception 'Customer details are too long';end if;
 insert into public.customer_profiles(store_name,address,phone,email,preferred_contact,interests,zoho_organization_id,zoho_contact_id,square_customer_id,address_confirmed)
 values(p_store,btrim(coalesce(p_data->>'address','')),btrim(coalesce(p_data->>'phone','')),btrim(coalesce(p_data->>'email','')),coalesce(p_data->>'preferred_contact',''),btrim(coalesce(p_data->>'interests','')),btrim(coalesce(p_data->>'zoho_organization_id','')),btrim(coalesce(p_data->>'zoho_contact_id','')),btrim(coalesce(p_data->>'square_customer_id','')),coalesce((p_data->>'address_confirmed')::boolean,false))
 on conflict(store_name) do update set address=excluded.address,phone=excluded.phone,email=excluded.email,preferred_contact=excluded.preferred_contact,interests=excluded.interests,zoho_organization_id=excluded.zoho_organization_id,zoho_contact_id=excluded.zoho_contact_id,square_customer_id=excluded.square_customer_id,address_confirmed=excluded.address_confirmed
 returning id into profile_id;
 update public.stores set zip=p_data->>'zip',category=btrim(coalesce(p_data->>'category','')),contact_name=btrim(coalesce(p_data->>'contact_name','')),
 phone_email=case when btrim(coalesce(p_data->>'phone',''))='' and btrim(coalesce(p_data->>'email',''))='' then phone_email else concat_ws(' · ',nullif(btrim(coalesce(p_data->>'phone','')),''),nullif(btrim(coalesce(p_data->>'email','')),'')) end where store_name=p_store;
 return profile_id;
end $$;
revoke all on function public.save_customer_profile(text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_customer_profile(text,integer,jsonb) to authenticated;

alter table public.customer_visit_notes
 add column crm_capture jsonb not null default '{}'::jsonb check(jsonb_typeof(crm_capture)='object' and octet_length(crm_capture::text)<=6000),
 add column capture_fingerprint text;
create function public.save_visit_capture(p_id uuid,p_store text,p_note text,p_sale jsonb default '{}'::jsonb,p_crm jsonb default '{}'::jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare existing public.customer_visit_notes; signature text; due date; title text; offer numeric;
begin
 if not public.is_owner() then raise exception 'Owner access required';end if;
 if p_id is null or p_store is null or p_note is null or length(btrim(p_note)) not between 1 and 2000 or p_sale is null or p_crm is null or jsonb_typeof(p_sale)<>'object' or jsonb_typeof(p_crm)<>'object' then raise exception 'Choose a customer and enter a valid note';end if;
 if exists(select 1 from jsonb_object_keys(p_sale) k where k not in ('activity_kind','product','quantity','quantity_unit','unit_price','discount_pct','discount_reason','sale_on')) or exists(select 1 from jsonb_object_keys(p_crm) k where k not in ('interest','offer_pct','offer_reason','samples_delivered','followup_on','followup_title')) then raise exception 'Unsupported capture details';end if;
 if p_sale<>'{}'::jsonb and coalesce(p_sale->>'activity_kind','')<>'sale_draft' then raise exception 'Sale details must remain a field draft';end if;
 if length(coalesce(p_crm->>'interest',''))>500 or length(coalesce(p_crm->>'offer_reason',''))>160 or length(coalesce(p_crm->>'followup_title',''))>200 then raise exception 'Captured details are too long';end if;
 if p_crm ? 'offer_pct' and p_crm->>'offer_pct' is not null then offer:=(p_crm->>'offer_pct')::numeric; if offer<0 or offer>100 or offer='NaN'::numeric then raise exception 'Invalid offer percentage';end if;end if;
 if p_crm ? 'samples_delivered' and jsonb_typeof(p_crm->'samples_delivered')<>'boolean' then raise exception 'Invalid sample status';end if;
 due:=nullif(p_crm->>'followup_on','')::date;title:=btrim(coalesce(p_crm->>'followup_title',''));
 if (due is null and title<>'') or (due is not null and title='') then raise exception 'A follow-up needs a date and title';end if;
 signature:=md5(jsonb_build_object('store',p_store,'note',btrim(p_note),'sale',p_sale,'crm',p_crm)::text);
 -- Serialize retries for the same operation before checking its immutable saved result.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into existing from public.customer_visit_notes where id=p_id;
 if existing.id is not null then
  if existing.capture_fingerprint=signature then return p_id;else raise exception 'This note was already saved with different details';end if;
 end if;
 insert into public.customer_visit_notes(id,store_name,note,activity_kind,product,quantity,quantity_unit,discount_pct,discount_reason,unit_price,sale_on,crm_capture,capture_fingerprint)
 values(p_id,p_store,btrim(p_note),coalesce(p_sale->>'activity_kind','note'),p_sale->>'product',(p_sale->>'quantity')::numeric,p_sale->>'quantity_unit',(p_sale->>'discount_pct')::numeric,p_sale->>'discount_reason',(p_sale->>'unit_price')::numeric,(p_sale->>'sale_on')::date,p_crm,signature);
 if due is not null then insert into public.customer_followups(id,store_name,title,due_on,kind,notes) values(p_id,p_store,title,due,'visit','Created from a shared visit note.');end if;
 return p_id;
end $$;
revoke all on function public.save_visit_capture(uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_visit_capture(uuid,text,text,jsonb,jsonb) to authenticated;

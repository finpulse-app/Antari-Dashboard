-- Antari owner access and data-integrity hardening. No business rows are deleted or rewritten.
-- Abort rather than grant access to an unexpected account population.
do $$ begin
  if (select count(*) from auth.users) <> 2 or (select count(*) from auth.users where email_confirmed_at is not null) <> 2 then
    raise exception 'Expected exactly two confirmed Antari owners. Review accounts before continuing.';
  end if;
end $$;

create table if not exists public.owner_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);
alter table public.owner_access enable row level security;
revoke all on public.owner_access from public, anon, authenticated;
grant select on public.owner_access to authenticated;
create policy owner_reads_own_membership on public.owner_access for select to authenticated using (user_id = (select auth.uid()));
insert into public.owner_access(user_id) select id from auth.users where email_confirmed_at is not null on conflict do nothing;

create or replace function public.is_owner() returns boolean language sql stable security invoker set search_path = ''
as $$ select exists(select 1 from public.owner_access where user_id = (select auth.uid())); $$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

do $$ declare t text; begin
 foreach t in array array['stores','name_mapping','sales_customer','sales_item','customer_balances','payments_received','festival_sales','zip_demographics','zip_ancestry','balance_payments','import_batches'] loop
   execute format('create policy antari_owner_required on public.%I as restrictive for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))', t);
 end loop;
end $$;

create index if not exists customer_balances_import_batch_idx on public.customer_balances(import_batch_id);
create index if not exists festival_sales_import_batch_idx on public.festival_sales(import_batch_id);
create index if not exists payments_received_import_batch_idx on public.payments_received(import_batch_id);
create index if not exists sales_customer_import_batch_idx on public.sales_customer(import_batch_id);
create index if not exists sales_item_import_batch_idx on public.sales_item(import_batch_id);
create index if not exists zip_ancestry_zip_idx on public.zip_ancestry(zip);
create unique index if not exists stores_name_case_unique on public.stores(lower(store_name));
create unique index if not exists name_mapping_case_unique on public.name_mapping(lower(zoho_name));

create or replace function public.clean_name(t text) returns text language sql immutable set search_path = ''
as $$ select btrim(regexp_replace(translate(coalesce(t,''), chr(8217)||chr(8216)||chr(96)||chr(180)||chr(160), chr(39)||chr(39)||chr(39)||chr(39)||' '), '[[:space:]]+', ' ', 'g')); $$;

create or replace function public.enforce_balance_payment_limit() returns trigger language plpgsql security invoker set search_path = ''
as $$
declare snap numeric; snap_date date; already numeric;
begin
 if not public.is_owner() then raise exception 'Owner access required'; end if;
 select outstanding_balance, as_of_date into snap, snap_date from public.customer_balances where id = new.balance_id for update;
 if snap is null then raise exception 'Unknown balance record'; end if;
 if snap_date <> (select max(as_of_date) from public.customer_balances) then raise exception 'This balance snapshot is no longer current. Refresh and try again.'; end if;
 if new.paid_on <= snap_date or new.paid_on > (now() at time zone 'America/New_York')::date then
   raise exception 'Payment date must be after the balance snapshot and no later than today.';
 end if;
 if new.amount is null or new.amount::text in ('NaN','Infinity','-Infinity') or new.amount <= 0 or new.amount <> round(new.amount,2) then raise exception 'Payment must be a positive amount in dollars and cents'; end if;
 if new.voided_at is not null or new.voided_by is not null or new.void_reason is not null then raise exception 'New payments cannot be pre-voided'; end if;
 select coalesce(sum(amount),0) into already from public.balance_payments where balance_id=new.balance_id and voided_at is null;
 if already+new.amount>snap then raise exception 'Payment is more than the remaining balance'; end if;
 new.recorded_by:=auth.uid(); new.recorded_by_email:=auth.jwt()->>'email'; new.created_at:=now();
 new.balance_before:=snap-already; new.balance_after:=snap-already-new.amount;
 return new;
end $$;

create or replace function public.guard_balance_payment_update() returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
 if not public.is_owner() then raise exception 'Owner access required'; end if;
 if old.voided_at is not null then raise exception 'This payment is already voided'; end if;
 if coalesce(btrim(new.void_reason),'')='' or length(new.void_reason)>500 then raise exception 'A void reason of 1 to 500 characters is required'; end if;
 if (new.id,new.balance_id,new.amount,new.paid_on,new.note,new.recorded_by,new.recorded_by_email,new.created_at,new.balance_before,new.balance_after)
 is distinct from
 (old.id,old.balance_id,old.amount,old.paid_on,old.note,old.recorded_by,old.recorded_by_email,old.created_at,old.balance_before,old.balance_after)
 then raise exception 'Payments cannot be edited. Void the payment and record a replacement.'; end if;
 new.void_reason:=btrim(new.void_reason); new.voided_at:=now(); new.voided_by:=auth.uid(); new.voided_by_email:=auth.jwt()->>'email';
 return new;
end $$;

create or replace function public.void_payment(p_ids bigint[],p_reason text) returns integer language plpgsql security invoker set search_path = ''
as $$ declare n integer; begin
 if not public.is_owner() then raise exception 'Owner access required'; end if;
 if coalesce(cardinality(p_ids),0)=0 or cardinality(p_ids)>100 then raise exception 'Choose 1 to 100 payments'; end if;
 if coalesce(btrim(p_reason),'')='' or length(p_reason)>500 then raise exception 'A void reason of 1 to 500 characters is required'; end if;
 perform cb.id from public.customer_balances cb where cb.id in (select balance_id from public.balance_payments where id=any(p_ids)) order by cb.id for update;
 update public.balance_payments set void_reason=p_reason where id=any(p_ids) and voided_at is null;
 get diagnostics n=row_count; return n;
end $$;

create or replace function public.create_customer(p_name text,p_zoho_name text,p_category text,p_zip text,p_route text) returns void language plpgsql security invoker set search_path = ''
as $$
begin
 if not public.is_owner() then raise exception 'Owner access required'; end if;
 p_name:=public.clean_name(p_name); p_zoho_name:=public.clean_name(p_zoho_name); p_route:=btrim(p_route);
 if p_name='' or p_name='Other' or p_zoho_name='' or coalesce(p_zip,'') !~ '^[0-9]{5}$' or coalesce(p_route,'')='' or p_category not in ('Market','Deli','Bakery','Restaurant') then raise exception 'A customer name, valid ZIP, category, route, and Zoho name are required'; end if;
 insert into public.stores(store_name,category,zip,delivery_route) values(p_name,p_category,p_zip,p_route);
 if lower(p_name)<>lower(p_zoho_name) then
   insert into public.name_mapping(zoho_name,mapped_store,reviewed,notes) values(p_zoho_name,p_name,true,'Created in the owner workspace')
   on conflict(zoho_name) do update set mapped_store=excluded.mapped_store,reviewed=true,notes=excluded.notes;
 end if;
end $$;

CREATE OR REPLACE FUNCTION public.import_report(p_type text, p_period_start date, p_period_end date, p_as_of date, p_file_name text, p_source_total numeric, p_rows jsonb, p_dry_run boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_n int; v_total numeric;
  v_reconcile_reason text; v_conflict_reason text;
  v_ex_start date; v_ex_end date;
  v_to_add int; v_skipped int := 0;
  v_batch bigint; v_period_text text; v_notes text;
begin
  if not public.is_owner() then raise exception 'Owner access required'; end if;
  if p_type is null then raise exception 'Report type is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('antari-import:' || p_type, 0));
  if p_type not in ('sales_customer','sales_item','customer_balances','payments_received','festival_sales') then
    raise exception 'Unknown report type: %', p_type;
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The report had no rows to import.';
  end if;
  if (p_period_end > (now() at time zone 'America/New_York')::date) or (p_as_of > (now() at time zone 'America/New_York')::date) then raise exception 'Report dates cannot be in the future'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n > 5000 then raise exception 'Reports must contain 5000 rows or fewer'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where
    jsonb_typeof(r) <> 'object'
    or (case when p_type in ('sales_item','festival_sales') then nullif(public.clean_name(r->>'item_name'),'') else nullif(public.clean_name(r->>'zoho_name'),'') end) is null
    or (case p_type when 'customer_balances' then r->>'outstanding_balance' when 'payments_received' then r->>'amount' else r->>'sales' end) is null
    or (case p_type when 'customer_balances' then r->>'outstanding_balance' when 'payments_received' then r->>'amount' else r->>'sales' end) in ('NaN','Infinity','-Infinity')
    or (p_type='sales_customer' and (r->>'invoice_count' is null or (r->>'invoice_count')::integer < 0))
    or (p_type in ('sales_item','festival_sales') and (r->>'quantity_sold' is null or r->>'quantity_sold' in ('NaN','Infinity','-Infinity')))
    or (p_type='payments_received' and (r->>'payment_date' is null or (r->>'payment_date')::date > (now() at time zone 'America/New_York')::date))
  ) then raise exception 'The report contains missing or invalid fields'; end if;

  v_total := (select coalesce(sum(case p_type
                when 'customer_balances' then (r->>'outstanding_balance')::numeric
                when 'payments_received' then (r->>'amount')::numeric
                else (r->>'sales')::numeric end), 0)
              from jsonb_array_elements(p_rows) r);
  if p_source_total is null then
    v_reconcile_reason := 'I couldn''t find the report''s own total, so I can''t verify these numbers.';
  elsif abs(v_total - p_source_total) > 0.005 then
    v_reconcile_reason := format('Doesn''t add up: the rows total $%s but the report says $%s (off by $%s).',
      to_char(v_total, 'FM999,999,990.00'), to_char(p_source_total, 'FM999,999,990.00'), to_char(abs(v_total - p_source_total), 'FM999,999,990.00'));
  end if;

  if p_type in ('sales_customer','sales_item','festival_sales') then
    if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
      v_conflict_reason := 'I couldn''t read the report''s date range.';
    else
      execute format('select min(period_start), max(period_end) from %I where period_start <= $1 and period_end >= $2', p_type)
        into v_ex_start, v_ex_end using p_period_end, p_period_start;
      if v_ex_start is not null then
        v_conflict_reason := format('Overlaps data already loaded (%s to %s). Each report must cover new dates only.',
          to_char(v_ex_start, 'Mon FMDD, YYYY'), to_char(v_ex_end, 'Mon FMDD, YYYY'));
      end if;
    end if;
  elsif p_type = 'customer_balances' then
    if p_as_of is null then
      v_conflict_reason := 'I couldn''t read the report''s "as of" date.';
    elsif exists (select 1 from customer_balances where as_of_date = p_as_of) then
      v_conflict_reason := format('A balance report for %s is already loaded.', to_char(p_as_of, 'Mon FMDD, YYYY'));
    end if;
  else
    with incoming as (
      select ord, (r->>'payment_date')::date as d, clean_name(r->>'zoho_name') as nm,
             coalesce(nullif(r->>'invoice_number',''), '') as inv, (r->>'amount')::numeric(12,2) as amt
      from jsonb_array_elements(p_rows) with ordinality as t(r, ord)
    ), keyed as (
      select *, row_number() over (partition by lower(nm), d, inv, amt order by ord) as occ from incoming
    ), existing as (
      select lower(clean_name(zoho_name)) as nm, payment_date as d, coalesce(invoice_number, '') as inv, amount as amt, count(*) as c
      from payments_received group by 1, 2, 3, 4
    )
    select count(*) filter (where k.occ > coalesce(e.c, 0)), count(*) filter (where k.occ <= coalesce(e.c, 0))
      into v_to_add, v_skipped
    from keyed k left join existing e on e.nm = lower(k.nm) and e.d = k.d and e.inv = k.inv and e.amt = k.amt;
    if v_to_add = 0 then
      v_conflict_reason := format('Nothing new: all %s payments in this report are already on file.', v_n);
    end if;
  end if;
  if v_to_add is null then v_to_add := v_n; end if;

  if p_dry_run then
    return jsonb_build_object('ok', v_reconcile_reason is null and v_conflict_reason is null, 'dry_run', true,
      'rows_in_file', v_n, 'to_add', v_to_add, 'skipped', v_skipped,
      'parsed_total', v_total, 'source_total', p_source_total,
      'reconcile_reason', v_reconcile_reason, 'conflict_reason', v_conflict_reason);
  end if;
  if v_reconcile_reason is not null then raise exception '%', v_reconcile_reason; end if;
  if v_conflict_reason is not null then raise exception '%', v_conflict_reason; end if;

  if v_skipped > 0 then
    v_notes := format('%s payment%s already on file and skipped (not doubled).', v_skipped, case when v_skipped = 1 then ' was' else 's were' end);
  end if;

  insert into import_batches (report_type, period_start, period_end, as_of_date, file_name, rows_in_file, rows_added, rows_skipped, source_total, parsed_total, reconciliation, notes)
  values (p_type, p_period_start, p_period_end, p_as_of, p_file_name, v_n, v_to_add, v_skipped, p_source_total, v_total, 'pass', v_notes)
  returning id into v_batch;

  v_period_text := to_char(p_period_start, 'Mon FMDD') || ' - ' || to_char(p_period_end, 'Mon FMDD, YYYY');

  if p_type = 'sales_customer' then
    insert into sales_customer (period, zoho_name, invoice_count, sales, period_start, period_end, import_batch_id)
    select v_period_text, clean_name(r->>'zoho_name'), (r->>'invoice_count')::int, (r->>'sales')::numeric, p_period_start, p_period_end, v_batch
    from jsonb_array_elements(p_rows) r;
  elsif p_type = 'sales_item' then
    insert into sales_item (period, item_name, sku, quantity_sold, sales, period_start, period_end, import_batch_id)
    select v_period_text, clean_name(r->>'item_name'), nullif(r->>'sku', ''), (r->>'quantity_sold')::numeric, (r->>'sales')::numeric, p_period_start, p_period_end, v_batch
    from jsonb_array_elements(p_rows) r;
  elsif p_type = 'festival_sales' then
    insert into festival_sales (period, item_name, quantity_sold, sales, period_start, period_end, import_batch_id)
    select v_period_text, clean_name(r->>'item_name'), (r->>'quantity_sold')::numeric, (r->>'sales')::numeric, p_period_start, p_period_end, v_batch
    from jsonb_array_elements(p_rows) r;
  elsif p_type = 'customer_balances' then
    insert into customer_balances (as_of_date, zoho_name, outstanding_balance, import_batch_id)
    select p_as_of, clean_name(r->>'zoho_name'), (r->>'outstanding_balance')::numeric, v_batch
    from jsonb_array_elements(p_rows) r;
  else
    insert into payments_received (payment_date, zoho_name, payment_mode, invoice_number, amount, import_batch_id)
    with incoming as (
      select ord, (r->>'payment_date')::date as d, clean_name(r->>'zoho_name') as nm, r->>'payment_mode' as md,
             coalesce(nullif(r->>'invoice_number',''), '') as inv, (r->>'amount')::numeric(12,2) as amt
      from jsonb_array_elements(p_rows) with ordinality as t(r, ord)
    ), keyed as (
      select *, row_number() over (partition by lower(nm), d, inv, amt order by ord) as occ from incoming
    ), existing as (
      select lower(clean_name(zoho_name)) as nm, payment_date as d, coalesce(invoice_number, '') as inv, amount as amt, count(*) as c
      from payments_received group by 1, 2, 3, 4
    )
    select k.d, k.nm, k.md, nullif(k.inv, ''), k.amt, v_batch
    from keyed k left join existing e on e.nm = lower(k.nm) and e.d = k.d and e.inv = k.inv and e.amt = k.amt
    where k.occ > coalesce(e.c, 0);
  end if;

  return jsonb_build_object('ok', true, 'dry_run', false, 'batch_id', v_batch, 'rows_in_file', v_n,
    'added', v_to_add, 'skipped', v_skipped, 'parsed_total', v_total, 'source_total', p_source_total);
end $function$
;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.clean_name(text) to authenticated;
grant execute on function public.import_report(text,date,date,date,text,numeric,jsonb,boolean) to authenticated;
grant execute on function public.void_payment(bigint[],text) to authenticated;
grant execute on function public.create_customer(text,text,text,text,text) to authenticated;


CREATE OR REPLACE FUNCTION public.enforce_balance_payment_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare snap numeric; already numeric;
begin
  select outstanding_balance into snap from customer_balances where id = new.balance_id for update;
  if snap is null then raise exception 'Unknown balance record'; end if;
  select coalesce(sum(amount), 0) into already from balance_payments where balance_id = new.balance_id and voided_at is null;
  if already + new.amount > snap + 0.001 then raise exception 'Payment is more than the remaining balance'; end if;
  new.balance_before := snap - already;
  new.balance_after  := snap - already - new.amount;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.clean_name(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select btrim(regexp_replace(
    replace(replace(replace(replace(coalesce(t,''), chr(8217), ''''), chr(8216), ''''), '`', ''''), chr(160), ' '),
    '\s+', ' ', 'g'))
$function$
;

CREATE OR REPLACE FUNCTION public.guard_balance_payment_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if old.voided_at is not null then raise exception 'This payment is already voided.'; end if;
  if coalesce(btrim(new.void_reason), '') = '' then raise exception 'A reason is required to void a payment.'; end if;
  if (new.id, new.balance_id, new.amount, new.paid_on, new.note, new.recorded_by, new.recorded_by_email, new.created_at, new.balance_before, new.balance_after)
     is distinct from
     (old.id, old.balance_id, old.amount, old.paid_on, old.note, old.recorded_by, old.recorded_by_email, old.created_at, old.balance_before, old.balance_after) then
    raise exception 'Payments can''t be edited. Void it and record a new one.';
  end if;
  new.voided_at := now(); new.voided_by := auth.uid(); new.voided_by_email := auth.jwt() ->> 'email';
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.void_payment(p_ids bigint[], p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare n int;
begin
  update balance_payments set void_reason = p_reason where id = any(p_ids) and voided_at is null;
  get diagnostics n = row_count;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.validate_name_mapping()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.zoho_name := clean_name(new.zoho_name);
  if new.mapped_store <> 'Other' and not exists (select 1 from stores where store_name = new.mapped_store) then
    raise exception 'Customer "%" is not on your customer list', new.mapped_store;
  end if;
  return new;
end $function$
;

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
  if p_type not in ('sales_customer','sales_item','customer_balances','payments_received','festival_sales') then
    raise exception 'Unknown report type: %', p_type;
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The report had no rows to import.';
  end if;
  v_n := jsonb_array_length(p_rows);

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

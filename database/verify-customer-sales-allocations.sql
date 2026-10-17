-- Requires one active multi-location allocation; all test edits roll back.
begin;
do $$ declare source_id integer; original numeric; n integer; total numeric;begin
 select source_sale_id into source_id from public.sales_customer_allocations where is_active group by source_sale_id having count(*)>1 order by source_sale_id limit 1;
 if source_id is null then raise exception 'No active multi-location allocation to verify';end if;
 select sales into original from public.sales_customer where id=source_id;
 select count(*),sum(sales) into n,total from public.v_sales_customer_mapped where id=source_id;
 if n<2 or total<>original then raise exception 'FAIL: split does not conserve revenue';end if;
 if exists(select 1 from public.v_sales_customer_mapped where id=source_id and (invoice_count is not null or not is_allocated)) then raise exception 'FAIL: invented invoice assignment';end if;
 if (select sum(sales) from public.v_sales_customer_mapped)<>(select sum(sales) from public.sales_customer) then raise exception 'FAIL: dashboard/source totals differ';end if;
 if exists(select 1 from public.sales_customer_allocations a join public.v_store_ranking r on r.store_name=a.store_name where a.source_sale_id=source_id and a.is_active and (r.invoices is not null or not r.has_estimated_sales)) then raise exception 'FAIL: estimated customer not flagged';end if;
 perform set_config('antari.test_source_id',source_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id::text from public.owner_access order by granted_at limit 1),'role','authenticated')::text,true);
end $$;
set local role authenticated;
do $$ declare source_id integer:=current_setting('antari.test_source_id')::integer; first_store text;begin
 select store_name into first_store from public.sales_customer_allocations where source_sale_id=source_id order by store_name limit 1;
 begin
  update public.sales_customer_allocations set is_active=false where source_sale_id=source_id and store_name=first_store;
  execute 'set constraints all immediate';
  raise exception 'FAIL: partial split was allowed';
 exception when raise_exception then
  if sqlerrm<>'The active allocation must equal the original report amount exactly' then raise;end if;
 end;
 update public.sales_customer_allocations set is_active=false where source_sale_id=source_id;
 execute 'set constraints all immediate';
 if (select count(*) from public.v_sales_customer_mapped m join public.sales_customer s on s.id=m.id where m.id=source_id and m.sales=s.sales and m.invoice_count=s.invoice_count and not m.is_allocated)<>1 then raise exception 'FAIL: disabling does not restore source mapping';end if;
 update public.sales_customer_allocations set is_active=true where source_sale_id=source_id;
 if (select count(*) from public.v_sales_customer_mapped where id=source_id)<2 then raise exception 'FAIL: restore failed';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.sales_customer_allocations) or exists(select 1 from public.v_sales_customer_mapped) then raise exception 'FAIL: non-owner can read allocations';end if;
 if has_column_privilege('authenticated','public.sales_customer_allocations','allocated_sales','UPDATE') then raise exception 'FAIL: allocation amounts editable from client';end if;
end $$;
reset role;
do $$ begin
 if has_table_privilege('anon','public.sales_customer_allocations','SELECT') then raise exception 'FAIL: anonymous read grant';end if;
end $$;
select 'PASS: conserved revenue, unassigned invoice counts, estimate flags, reversible whole-group toggles, and owner-only access' as result;
rollback;

-- Preserve imported reports; allocate only explicitly selected historical rows.
create table public.sales_customer_allocations (
 source_sale_id integer not null references public.sales_customer(id),
 store_name text not null references public.stores(store_name),
 allocated_sales numeric(12,2) not null check(allocated_sales>0 and allocated_sales<1000000000 and allocated_sales=round(allocated_sales,2)),
 notes text not null check(length(btrim(notes)) between 1 and 2000),
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 primary key(source_sale_id,store_name)
);
create index sales_customer_allocations_store_idx on public.sales_customer_allocations(store_name);
alter table public.sales_customer_allocations enable row level security;
revoke all on public.sales_customer_allocations from public,anon,authenticated;
grant select on public.sales_customer_allocations to authenticated;
grant update(is_active) on public.sales_customer_allocations to authenticated;
create policy owners_read_sales_allocations on public.sales_customer_allocations for select to authenticated using ((select public.is_owner()));
create policy owners_toggle_sales_allocations on public.sales_customer_allocations for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

-- A group must either be disabled or allocate the complete source amount exactly.
create function public.check_sales_allocation_total() returns trigger language plpgsql security invoker set search_path='' as $$
declare source_id integer; original numeric; allocated numeric; n integer;begin
 if tg_table_name='sales_customer' then source_id:=new.id;
 elsif tg_op='DELETE' then source_id:=old.source_sale_id;
 else source_id:=new.source_sale_id;end if;
 select sales into original from public.sales_customer where id=source_id;
 select sum(allocated_sales),count(*) into allocated,n from public.sales_customer_allocations where source_sale_id=source_id and is_active;
 if n>0 and (original is null or allocated<>original) then raise exception 'The active allocation must equal the original report amount exactly';end if;
 return null;
end $$;
revoke all on function public.check_sales_allocation_total() from public,anon,authenticated;
create constraint trigger sales_allocation_total after insert or update or delete on public.sales_customer_allocations deferrable initially deferred for each row execute function public.check_sales_allocation_total();
create constraint trigger sales_allocation_source_total after update on public.sales_customer deferrable initially deferred for each row execute function public.check_sales_allocation_total();

create or replace view public.v_sales_customer_mapped with (security_invoker=true) as
 select sc.id,sc.period,sc.zoho_name,
 case when a.source_sale_id is not null then null::integer else sc.invoice_count end as invoice_count,
 coalesce(a.allocated_sales,sc.sales)::numeric(12,2) as sales,
 coalesce(a.store_name,s.store_name,nm.mapped_store,'Other'::text) as mapped_store,
 sc.period_start,sc.period_end,sc.import_batch_id,
 (a.source_sale_id is not null) as is_allocated,
 a.notes as allocation_note,
 sc.invoice_count as source_invoice_count
 from public.sales_customer sc
 left join public.sales_customer_allocations a on a.source_sale_id=sc.id and a.is_active
 left join public.stores s on lower(s.store_name)=lower(sc.zoho_name)
 left join public.name_mapping nm on lower(nm.zoho_name)=lower(sc.zoho_name);

create or replace view public.v_store_ranking with (security_invoker=true) as
 select st.store_name,coalesce(sum(vsc.sales),0::numeric) as total_revenue,
 case when coalesce(bool_or(vsc.is_allocated),false) then null::bigint else coalesce(sum(vsc.invoice_count),0::bigint) end as invoices,
 (select max(vp.payment_date) from public.v_payments_mapped vp where vp.mapped_store=st.store_name) as last_payment_date,
 rank() over(order by coalesce(sum(vsc.sales),0::numeric) desc) as revenue_rank,
 coalesce(bool_or(vsc.is_allocated),false) as has_estimated_sales
 from public.stores st left join public.v_sales_customer_mapped vsc on vsc.mapped_store=st.store_name group by st.store_name;

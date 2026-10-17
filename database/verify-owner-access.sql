begin;

select set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id::text from public.owner_access order by granted_at limit 1),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if not public.is_owner() then raise exception 'FAIL: existing owner rejected'; end if;
 if (select count(*) from public.stores)=0 then raise exception 'FAIL: owner cannot read stores'; end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 if public.is_owner() then raise exception 'FAIL: stranger granted owner access'; end if;
 if (select count(*) from public.stores)<>0 or (select count(*) from public.v_channel_summary where net_revenue<>0)<>0 then raise exception 'FAIL: stranger sees business data'; end if;
 begin
  perform public.import_report('sales_customer','2020-01-01','2020-01-31',null,'test',1,'[{"zoho_name":"test","invoice_count":1,"sales":1}]',true);
  raise exception 'FAIL: stranger can invoke import';
 exception when others then if sqlerrm <> 'Owner access required' then raise; end if; end;
end $$;
reset role;
set local role anon;
do $$ begin
 if (select count(*) from public.stores)<>0 then raise exception 'FAIL: anonymous sees stores'; end if;
 if has_function_privilege('anon','public.import_report(text,date,date,date,text,numeric,jsonb,boolean)','execute') then raise exception 'FAIL: anonymous RPC execution'; end if;
end $$;
reset role;
select 'PASS: owner access retained; stranger and anonymous access denied; imports restricted' as result;

rollback;


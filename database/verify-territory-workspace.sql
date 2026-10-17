begin;
do $$ begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id::text from public.owner_access order by granted_at limit 1),'role','authenticated','email','territory-test@example.invalid')::text,true);
 perform set_config('antari.second_owner',(select user_id::text from public.owner_access order by granted_at offset 1 limit 1),true);
end $$;
set local role authenticated;
do $$ declare pid uuid; rev integer; actor uuid; sid text; n integer; baseline numeric; after_total numeric; begin
 select store_name into sid from public.stores where store_name<>'Other' order by store_name limit 1;
 select coalesce(sum(net_revenue),0) into baseline from public.v_channel_summary;
 insert into public.territory_prospects(business_name,zip,created_by,updated_by,revision) values('ANTARI ROLLBACK TEST','11235','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',90) returning id,revision,created_by into pid,rev,actor;
 if rev<>1 or actor<>auth.uid() then raise exception 'FAIL: insert author/revision stamp'; end if;
 update public.territory_prospects set stage='sampled',updated_by='00000000-0000-0000-0000-000000000001' where id=pid and revision=1 returning revision,updated_by into rev,actor;
 if rev<>2 or actor<>auth.uid() then raise exception 'FAIL: update author/revision stamp'; end if;
 update public.territory_prospects set stage='contacted' where id=pid and revision=1;
 get diagnostics n=row_count;
 if n<>0 then raise exception 'FAIL: stale revision overwrote data'; end if;
 begin
  insert into public.territory_prospects(business_name,zip) values('antari rollback test','11235');
  raise exception 'FAIL: duplicate prospect allowed';
 exception when unique_violation then null;end;
 insert into public.customer_followups(store_name,title,due_on) values(sid,'Rollback test action',current_date);
 insert into public.territory_scenarios(title,customers,order_value,orders_per_month,margin_pct,monthly_cost) values('Rollback test plan',5,100,2,30,50);
 insert into public.territory_initiatives(title,zip,hypothesis,starts_on,review_on,success_measure) values('Rollback test project','11235','Test ownership',current_date,current_date,'No rows persist');
 insert into public.customer_visit_notes(store_name,note,activity_kind,product,quantity,quantity_unit,discount_pct,discount_reason,unit_price) values(sid,'Rollback test: sold 100 bottles of juice, 10% first time discount','sale_draft','juice',100,'bottles',10,'First purchase',2);
 begin
  insert into public.customer_visit_notes(store_name,note,activity_kind,product,quantity,discount_pct) values(sid,'Invalid discount test','sale_draft','juice',100,101);
  raise exception 'FAIL: invalid discount allowed';
 exception when check_violation then null;end;
 begin
  insert into public.customer_visit_notes(store_name,note,activity_kind,quantity) values(sid,'Missing product test','sale_draft',100);
  raise exception 'FAIL: sale draft missing product allowed';
 exception when check_violation then null;end;
 select coalesce(sum(net_revenue),0) into after_total from public.v_channel_summary;
 if baseline<>after_total then raise exception 'FAIL: field draft changed financial totals'; end if;
 if has_table_privilege('authenticated','public.territory_prospects','delete') then raise exception 'FAIL: physical deletion granted'; end if;
end $$;
reset role;
do $$ begin perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('antari.second_owner'),'role','authenticated','email','second-owner@example.invalid')::text,true);end $$;
set local role authenticated;
do $$ begin
 if (select count(*) from public.territory_prospects where business_name='ANTARI ROLLBACK TEST')<>1 then raise exception 'FAIL: co-owner cannot read shared record';end if;
 update public.territory_prospects set stage='first_order' where business_name='ANTARI ROLLBACK TEST';
 if (select stage from public.territory_prospects where business_name='ANTARI ROLLBACK TEST')<>'first_order' then raise exception 'FAIL: co-owner cannot update shared record';end if;
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
 if (select count(*) from public.territory_prospects)<>0 or (select count(*) from public.customer_followups)<>0 or (select count(*) from public.territory_scenarios)<>0 or (select count(*) from public.territory_initiatives)<>0 then raise exception 'FAIL: non-owner sees shared records';end if;
 begin
  insert into public.territory_prospects(business_name,zip) values('Unauthorized test','11235');
  raise exception 'FAIL: stranger write allowed';
 exception when others then if sqlerrm<>'Owner access required' then raise;end if;end;
end $$;
reset role;
do $$ declare t text;begin
 foreach t in array array['territory_prospects','customer_followups','territory_scenarios','territory_initiatives'] loop
  if has_table_privilege('anon','public.'||t,'select') or has_table_privilege('anon','public.'||t,'insert') then raise exception 'FAIL: anonymous privilege';end if;
 end loop;
end $$;
select 'PASS: two-owner sharing, stamped authors, stale edit protection, duplicate prevention, sale-draft validation, financial isolation, and stranger/anonymous restrictions' as result;
rollback;

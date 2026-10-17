begin;
select set_config('request.jwt.claims', jsonb_build_object('sub',(select user_id::text from public.owner_access limit 1),'email','audit-test-owner','role','authenticated')::text,true);
set local role authenticated;
do $$
declare bid integer; snap date; before numeric; afterpay numeric; actor uuid;
begin
 select id,as_of_date into bid,snap from public.customer_balances where as_of_date=(select max(as_of_date) from public.customer_balances) and outstanding_balance>1 limit 1;
 select outstanding_balance into before from public.v_open_balances where balance_id=bid;
 begin
  insert into public.balance_payments(id,balance_id,amount,paid_on) values(-900001,bid,.01,snap);
  raise exception 'FAIL: pre-snapshot payment accepted';
 exception when others then if sqlerrm not like 'Payment date must be after%' then raise; end if; end;
 begin
  insert into public.balance_payments(id,balance_id,amount,paid_on) values(-900001,bid,999999999,(now() at time zone 'America/New_York')::date);
  raise exception 'FAIL: overpayment accepted';
 exception when others then if sqlerrm <> 'Payment is more than the remaining balance' then raise; end if; end;
 insert into public.balance_payments(id,balance_id,amount,paid_on,recorded_by,recorded_by_email) values(-900001,bid,.01,(now() at time zone 'America/New_York')::date,'00000000-0000-0000-0000-000000000001','forged@example.invalid');
 select recorded_by into actor from public.balance_payments where id=-900001;
 if actor<>auth.uid() then raise exception 'FAIL: forged actor accepted'; end if;
 select outstanding_balance into afterpay from public.v_open_balances where balance_id=bid;
 if afterpay<>before-.01 then raise exception 'FAIL: balance not reduced exactly'; end if;
 perform public.void_payment(array[-900001::bigint],'Rollback validation only');
 select outstanding_balance into afterpay from public.v_open_balances where balance_id=bid;
 if afterpay<>before then raise exception 'FAIL: void did not restore balance'; end if;
 begin
  update public.balance_payments set amount=50 where id=-900001;
 exception when others then if sqlerrm <> 'This payment is already voided' then raise; end if; end;
 if (select amount from public.balance_payments where id=-900001)<>.01 then raise exception 'FAIL: voided payment changed'; end if;
end $$;
reset role;
select 'PASS: invalid dates and overpayment rejected; actor protected; payment/void balance arithmetic exact; financial test rolled back' as result;
rollback;

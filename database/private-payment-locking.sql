-- Row locks require privileged locking because report snapshots intentionally have no UPDATE policy.
-- Keep the limited privilege inside an unexposed private schema with explicit owner checks.
create schema if not exists antari_private;
revoke all on schema antari_private from public, anon;
grant usage on schema antari_private to authenticated;
create or replace function antari_private.enforce_balance_payment_limit() returns trigger language plpgsql security definer set search_path = ''
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


revoke all on function antari_private.enforce_balance_payment_limit() from public, anon, authenticated;
drop trigger trg_enforce_balance_payment_limit on public.balance_payments;
create trigger trg_enforce_balance_payment_limit before insert on public.balance_payments for each row execute function antari_private.enforce_balance_payment_limit();
drop function public.enforce_balance_payment_limit();

create or replace function antari_private.lock_payment_balances(p_ids bigint[]) returns void language plpgsql security definer set search_path = ''
as $$ begin
 if not public.is_owner() then raise exception 'Owner access required'; end if;
 perform cb.id from public.customer_balances cb where cb.id in (select balance_id from public.balance_payments where id=any(p_ids)) order by cb.id for update;
end $$;
revoke all on function antari_private.lock_payment_balances(bigint[]) from public, anon;
grant execute on function antari_private.lock_payment_balances(bigint[]) to authenticated;

create or replace function public.void_payment(p_ids bigint[],p_reason text) returns integer language plpgsql security invoker set search_path = ''
as $$ declare n integer; begin
 if not public.is_owner() then raise exception 'Owner access required'; end if;
 if coalesce(cardinality(p_ids),0)=0 or cardinality(p_ids)>100 then raise exception 'Choose 1 to 100 payments'; end if;
 if coalesce(btrim(p_reason),'')='' or length(p_reason)>500 then raise exception 'A void reason of 1 to 500 characters is required'; end if;
 perform antari_private.lock_payment_balances(p_ids);
 update public.balance_payments set void_reason=p_reason where id=any(p_ids) and voided_at is null;
 get diagnostics n=row_count; return n;
end $$;
revoke all on function public.void_payment(bigint[],text) from public, anon;
grant execute on function public.void_payment(bigint[],text) to authenticated;


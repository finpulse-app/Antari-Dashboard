-- Preserve trustworthy actor attribution for every new import batch.
create or replace function public.stamp_import_actor() returns trigger language plpgsql security invoker set search_path = ''
as $$ begin
 if not public.is_owner() then raise exception 'Owner access required'; end if;
 new.imported_by:=auth.uid(); new.imported_by_email:=auth.jwt()->>'email'; new.imported_at:=now();
 return new;
end $$;
create trigger antari_stamp_import_actor before insert on public.import_batches for each row execute function public.stamp_import_actor();
revoke execute on function public.stamp_import_actor() from public, anon, authenticated;


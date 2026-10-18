-- Owner profile edits can update only these metadata columns on the legacy store record.
-- Store identity, route and acquisition fields retain their existing access rules.
revoke update on public.stores from authenticated, anon;
grant update(zip,category,contact_name,phone_email) on public.stores to authenticated;
create policy owners_edit_location_metadata on public.stores for update to authenticated
 using ((select public.is_owner())) with check ((select public.is_owner()));

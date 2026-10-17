-- Existing case-insensitive indexes already cover these columns.
drop index if exists public.stores_name_case_unique;
drop index if exists public.name_mapping_case_unique;

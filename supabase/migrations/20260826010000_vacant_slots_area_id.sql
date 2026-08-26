alter table public.vacant_slots
  add column area_id uuid references public.areas(id) on delete set null;

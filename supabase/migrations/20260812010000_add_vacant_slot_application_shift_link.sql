alter table public.vacant_slot_applications add column shift_id uuid references public.shifts(id) on delete set null;

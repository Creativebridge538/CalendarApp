alter table public.sales add column shift_id uuid references public.shifts(id) on delete set null;
create index idx_sales_shift_id on public.sales(shift_id);

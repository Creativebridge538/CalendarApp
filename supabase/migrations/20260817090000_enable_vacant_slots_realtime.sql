alter publication supabase_realtime add table vacant_slots;
alter table vacant_slots replica identity full;

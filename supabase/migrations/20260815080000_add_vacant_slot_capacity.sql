-- 空き枠に募集人数を設定できるようにする。既存枠は互換のため1人扱いにする
alter table vacant_slots add column capacity int not null default 1;
alter table vacant_slots add constraint vacant_slots_capacity_positive check (capacity > 0);

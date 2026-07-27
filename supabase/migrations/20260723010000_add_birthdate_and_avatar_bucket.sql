-- キャストのプロフィール編集（生年月日・表示可否）
alter table public.users add column birthdate date;
alter table public.users add column show_birthdate boolean not null default false;

-- アバター画像用バケット（本人のみ読み書き可、表示は公開）
insert into storage.buckets (id, name, public, file_size_limit)
values ('cast-avatars', 'cast-avatars', true, 5242880)
on conflict (id) do nothing;

create policy "cast-avatars: 誰でも参照可" on storage.objects for select
  using (bucket_id = 'cast-avatars');

create policy "cast-avatars: 本人のみアップロード" on storage.objects for insert
  with check (
    bucket_id = 'cast-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "cast-avatars: 本人のみ更新" on storage.objects for update
  using (
    bucket_id = 'cast-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "cast-avatars: 本人のみ削除" on storage.objects for delete
  using (
    bucket_id = 'cast-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

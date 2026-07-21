-- 店舗ロゴなどのアセット用バケット
insert into storage.buckets (id, name, public, file_size_limit)
values ('store-assets', 'store-assets', true, 5242880)
on conflict (id) do nothing;

-- 誰でも参照可（ロゴは支払通知書等で埋め込み表示するため公開）
create policy "store-assets: 誰でも参照可" on storage.objects for select
  using (bucket_id = 'store-assets');

-- 書き込みはオブジェクトパス先頭(store_id)が自分の店舗と一致する管理者のみ
create policy "store-assets: admin が自店舗分のみアップロード" on storage.objects for insert
  with check (
    bucket_id = 'store-assets'
    and (storage.foldername(name))[1] = my_store_id()::text
    and my_role() = 'admin'
  );

create policy "store-assets: admin が自店舗分のみ更新" on storage.objects for update
  using (
    bucket_id = 'store-assets'
    and (storage.foldername(name))[1] = my_store_id()::text
    and my_role() = 'admin'
  );

create policy "store-assets: admin が自店舗分のみ削除" on storage.objects for delete
  using (
    bucket_id = 'store-assets'
    and (storage.foldername(name))[1] = my_store_id()::text
    and my_role() = 'admin'
  );

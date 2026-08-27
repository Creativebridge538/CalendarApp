-- 「発行」を押すたびに最新内容へ更新できるようにしつつ、管理者が「編集」機能で
-- 意図的に補正した通知書だけは、その後の再発行で上書きされないよう保護する
alter table public.payment_notices
  add column manually_edited boolean not null default false;

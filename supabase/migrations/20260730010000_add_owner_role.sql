-- 店舗に属さない、全店舗を管理する最高権限アカウント用のロールを追加
alter type user_role add value 'owner';

-- デザインテーマ選択UIをいったん撤去し、全店舗を単一テーマ(default/Mono)に揃える。
-- 配色定義(globals.cssの[data-theme]、app-nav.tsxのTHEME_STYLES)自体は将来の再導入に備えて残す。
update store_settings set theme = 'default' where theme <> 'default';

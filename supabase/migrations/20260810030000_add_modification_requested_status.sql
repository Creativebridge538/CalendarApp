-- 修正申請中であることを一目で分かるようにするため、shift_statusに新しい値を追加する。
-- 申請時にshiftsのstatusをこの値に変更し、承認/却下でsubmitted/confirmedへ戻す。
alter type shift_status add value 'modification_requested';

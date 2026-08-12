-- 譜面一覧のサムネイルから流すプレビューの開始位置 (秒)。
-- 未設定 (NULL) の譜面は歌詞の最初のタイムタグ位置で代用する。
alter table public.charts
  add column if not exists preview_time real;

comment on column public.charts.preview_time is
  'プレビュー再生の開始位置 (秒)。NULL なら最初のタイムタグ時刻を使う';

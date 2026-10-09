-- 可选：用 Supabase 自带的定时任务给游戏服务端“保活”（作为 cron-job.org / UptimeRobot 的备份）。
-- 在 Supabase 控制台 → SQL Editor 中执行；先把下面的地址换成你的 Render 服务地址。
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'daieryou-keepalive',
  '*/10 * * * *',
  $$ select net.http_get(url := 'https://daieryou.YOUR-SUBDOMAIN.workers.dev/healthz', timeout_milliseconds := 30000) $$
);

-- 查看执行记录： select * from cron.job_run_details order by start_time desc limit 10;
-- 取消定时任务： select cron.unschedule('daieryou-keepalive');

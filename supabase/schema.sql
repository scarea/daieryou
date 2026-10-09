-- 逮二游 Postgres 表结构（Supabase 兼容）。脚本可重复执行，服务端启动时会自动执行一次。
-- 时间字段统一存毫秒时间戳（bigint），与 MongoDB 版本保持一致。

create table if not exists accounts (
  user_id text primary key,
  email text not null unique,
  username text not null,
  password_salt text not null,
  password_hash text not null,
  verified_at bigint not null,
  created_at bigint not null,
  updated_at bigint not null,
  last_login_at bigint,
  is_member boolean not null default false,
  is_admin boolean not null default false,
  member_expires_at bigint,
  invited_by_user_id text
);

create table if not exists invite_codes (
  code text primary key,
  creator_user_id text not null,
  channel text not null default 'member',
  campaign text not null default '',
  remark text not null default '',
  status text not null default 'active' check (status in ('active', 'used', 'expired', 'disabled')),
  expires_at bigint not null,
  used_count integer not null default 0,
  max_uses integer not null default 1,
  used_by_user_id text,
  used_by_email text,
  used_at bigint,
  disabled_by_user_id text,
  disabled_reason text,
  created_at bigint not null,
  updated_at bigint not null
);
create index if not exists invite_codes_status_created_idx on invite_codes (status, created_at desc);
create index if not exists invite_codes_creator_idx on invite_codes (creator_user_id);

create table if not exists admin_audit_logs (
  id bigint generated always as identity primary key,
  action text not null,
  actor_user_id text,
  actor_email text,
  target_user_id text,
  target_email text,
  source text not null default 'system',
  detail jsonb not null default '{}'::jsonb,
  created_at bigint not null
);
create index if not exists admin_audit_logs_created_idx on admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_action_created_idx on admin_audit_logs (action, created_at desc);

create table if not exists battle_records (
  user_id text not null,
  match_id text not null,
  room_id text not null default '',
  finished_at bigint not null,
  player_count integer not null,
  rank integer not null,
  username text not null,
  total_score double precision not null,
  round_scores jsonb not null default '[]'::jsonb,
  opponents jsonb not null default '[]'::jsonb,
  created_at bigint not null,
  updated_at bigint not null,
  primary key (user_id, match_id)
);
create index if not exists battle_records_user_finished_idx on battle_records (user_id, finished_at desc);
create index if not exists battle_records_user_room_finished_idx on battle_records (user_id, room_id, finished_at desc);
create index if not exists battle_records_user_rank_finished_idx on battle_records (user_id, rank, finished_at desc);
create index if not exists battle_records_finished_idx on battle_records (finished_at);

create table if not exists battle_record_archives (
  user_id text not null,
  match_id text not null,
  room_id text not null default '',
  finished_at bigint not null,
  player_count integer not null,
  rank integer not null,
  username text not null,
  total_score double precision not null,
  round_scores jsonb not null default '[]'::jsonb,
  opponents jsonb not null default '[]'::jsonb,
  created_at bigint not null,
  updated_at bigint not null,
  archived_at bigint not null,
  primary key (user_id, match_id)
);
create index if not exists battle_record_archives_archived_idx on battle_record_archives (archived_at desc);

-- 服务端心跳：定期写一行，既用于健康检查，也让 Supabase 免费项目保持“活跃”不被暂停
create table if not exists service_heartbeats (
  service text primary key,
  beat_at bigint not null,
  detail jsonb not null default '{}'::jsonb
);

-- 所有表开启 RLS 且不配置任何策略：Supabase 对外的 REST/anon key 无法读写这些表，
-- 只有游戏服务端使用的数据库连接（postgres 角色，绕过 RLS）可以访问。
alter table accounts enable row level security;
alter table invite_codes enable row level security;
alter table admin_audit_logs enable row level security;
alter table battle_records enable row level security;
alter table battle_record_archives enable row level security;
alter table service_heartbeats enable row level security;

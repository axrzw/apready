-- Supabase / Postgres version of packages/db/src/schema.ts (used by SupabaseRepo).
create table if not exists works (id text primary key, category text not null, tier text not null, popularity double precision not null default 0, score double precision, year integer, title text not null, data jsonb not null, updated_at bigint not null);
create index if not exists works_cat_tier on works(category, tier);
create table if not exists characters (id text primary key, work_id text not null, data jsonb not null);
create index if not exists characters_work on characters(work_id);
create table if not exists people (id text primary key, data jsonb not null);
create table if not exists themes (id text primary key, work_id text not null, data jsonb not null);
create table if not exists media (id text primary key, work_id text not null, kind text not null, data jsonb not null);
create table if not exists users (id text primary key, data jsonb not null, created_at bigint not null);
create table if not exists answers (id bigint generated always as identity primary key, user_id text not null, question_key text not null, mode text not null, work_id text not null, category text not null, tier text not null, correct integer not null, points integer not null, method text not null, hints_used integer not null default 0, room_code text, role text, at bigint not null);
create index if not exists answers_user on answers(user_id, at);
create table if not exists reports (id text primary key, user_id text not null, question_key text not null, work_id text, reason text not null, status text not null, at bigint not null);
create table if not exists drawings (id text primary key, room_code text not null, user_id text not null, work_id text not null, subject text not null, png text not null, votes_best integer not null default 0, votes_funny integer not null default 0, at bigint not null);
create table if not exists settings (key text primary key, value jsonb not null);
create table if not exists jobs (id bigint generated always as identity primary key, name text not null, status text not null, detail text, at bigint not null);

-- The site talks to the database only from the server with the service role key.
-- Row level security on, no policies: the anon key can read nothing.
alter table works enable row level security;
alter table characters enable row level security;
alter table people enable row level security;
alter table themes enable row level security;
alter table media enable row level security;
alter table users enable row level security;
alter table answers enable row level security;
alter table reports enable row level security;
alter table drawings enable row level security;
alter table settings enable row level security;
alter table jobs enable row level security;

-- Storage buckets for clips, processed images and drawings (private).
insert into storage.buckets (id, name, public) values ('media', 'media', false) on conflict do nothing;

-- Vote helper used by SupabaseRepo.voteDrawing
create or replace function vote_drawing(drawing_id text, kind text) returns void language sql as $$
  update drawings set votes_best = votes_best + case when kind = 'best' then 1 else 0 end,
                      votes_funny = votes_funny + case when kind = 'funny' then 1 else 0 end
  where id = drawing_id;
$$;

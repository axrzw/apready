export const SQLITE_SCHEMA = `
-- Same tables for SQLite (local) and Postgres (Supabase). "data" holds the full JSON object.
create table if not exists works (
  id text primary key,
  category text not null,
  tier text not null,
  popularity real not null default 0,
  score real,
  year integer,
  title text not null,
  data text not null,
  updated_at integer not null
);
create index if not exists works_cat_tier on works(category, tier);

create table if not exists characters (id text primary key, work_id text not null, data text not null);
create index if not exists characters_work on characters(work_id);
create table if not exists people (id text primary key, data text not null);
create table if not exists themes (id text primary key, work_id text not null, data text not null);
create table if not exists media (id text primary key, work_id text not null, kind text not null, data text not null);
create index if not exists media_work on media(work_id);

create table if not exists users (id text primary key, data text not null, created_at integer not null);

create table if not exists answers (
  id integer primary key autoincrement,
  user_id text not null,
  question_key text not null,
  mode text not null,
  work_id text not null,
  category text not null,
  tier text not null,
  correct integer not null,
  points integer not null,
  method text not null,
  hints_used integer not null default 0,
  room_code text,
  role text,
  at integer not null
);
create index if not exists answers_user on answers(user_id, at);
create index if not exists answers_key on answers(question_key);

create table if not exists reports (id text primary key, user_id text not null, question_key text not null, work_id text, reason text not null, status text not null, at integer not null);
create table if not exists drawings (id text primary key, room_code text not null, user_id text not null, work_id text not null, subject text not null, png text not null, votes_best integer not null default 0, votes_funny integer not null default 0, at integer not null);
create table if not exists settings (key text primary key, value text not null);
create table if not exists jobs (id integer primary key autoincrement, name text not null, status text not null, detail text, at integer not null);
`;

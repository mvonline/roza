create table public.meetings (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  created_at bigint not null,
  updated_at bigint not null,
  started_at bigint,
  ended_at bigint,
  language text not null,
  status text not null,
  labels text[] not null default '{}',
  last_persisted_sequence integer not null default 0,
  deleted_at bigint
);

create table public.transcript_segments (
  id uuid primary key,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence integer not null,
  text text not null,
  recognized_text text not null,
  translated_text text,
  created_at bigint not null,
  updated_at bigint not null,
  edited_at bigint,
  deleted_at bigint,
  unique (meeting_id, sequence)
);

alter table public.meetings enable row level security;
alter table public.transcript_segments enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.meetings to authenticated;
grant select, insert, update, delete on public.transcript_segments to authenticated;
revoke all on public.meetings from anon;
revoke all on public.transcript_segments from anon;

create policy "own meetings" on public.meetings for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own segments" on public.transcript_segments for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index meetings_user_updated on public.meetings (user_id, updated_at);
create index segments_user_updated on public.transcript_segments (user_id, updated_at);

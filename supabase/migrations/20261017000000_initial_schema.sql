-- Panel 2.0: initial secure multi-user schema
begin;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text check (display_name is null or char_length(display_name)<=100),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.sites (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 name text not null check (char_length(trim(name)) between 1 and 160),
 url text not null check (url ~* '^https?://'),
 goal text not null default '' check (char_length(goal)<=2000),
 wallet_label text not null default '' check (char_length(wallet_label)<=160),
 status text not null default 'to_test' check (status in ('to_test','testing','reliable','review','abandoned')),
 notes text not null default '' check (char_length(notes)<=10000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index sites_user_updated_idx on public.sites(user_id,updated_at desc);
create index sites_user_status_idx on public.sites(user_id,status);

create table public.sessions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 site_id uuid not null references public.sites(id) on delete cascade,
 status text not null default 'active' check (status in ('active','paused','completed')),
 started_at timestamptz not null default now(), last_resumed_at timestamptz,
 elapsed_seconds bigint not null default 0 check (elapsed_seconds>=0), finished_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint sessions_state_consistency check (
  (status='active' and last_resumed_at is not null and finished_at is null) or
  (status='paused' and last_resumed_at is null and finished_at is null) or
  (status='completed' and last_resumed_at is null and finished_at is not null))
);
create unique index sessions_one_open_per_user on public.sessions(user_id) where status in ('active','paused');
create index sessions_user_started_idx on public.sessions(user_id,started_at desc);
create index sessions_site_idx on public.sessions(site_id);

create table public.reward_transactions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 site_id uuid not null references public.sites(id) on delete cascade,
 kind text not null check (kind in ('reward','fee','payout','adjustment')),
 amount numeric(24,10) not null check (amount>0),
 currency text not null default 'USD' check (currency ~ '^[A-Z0-9]{2,12}$'),
 status text not null default 'pending' check (status in ('pending','confirmed','failed')),
 reference text not null default '' check (char_length(reference)<=300),
 tx_hash text not null default '' check (char_length(tx_hash)<=300),
 notes text not null default '' check (char_length(notes)<=5000),
 occurred_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index rewards_user_occurred_idx on public.reward_transactions(user_id,occurred_at desc);
create index rewards_site_idx on public.reward_transactions(site_id);
create index rewards_user_kind_status_idx on public.reward_transactions(user_id,kind,status);

create table public.audit_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 event_type text not null check (char_length(event_type) between 1 and 100),
 entity_type text not null check (char_length(entity_type) between 1 and 100),
 entity_id uuid, details jsonb not null default '{}'::jsonb check (pg_column_size(details)<=8192),
 created_at timestamptz not null default now()
);
create index audit_user_created_idx on public.audit_events(user_id,created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path=''
as $$ begin new.updated_at=now(); return new; end; $$;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger sites_set_updated_at before update on public.sites for each row execute function public.set_updated_at();
create trigger sessions_set_updated_at before update on public.sessions for each row execute function public.set_updated_at();
create trigger reward_transactions_set_updated_at before update on public.reward_transactions for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 insert into public.profiles(id,display_name)
 values(new.id,nullif(left(coalesce(new.raw_user_meta_data->>'display_name',''),100),''))
 on conflict(id) do nothing;
 return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.sessions enable row level security;
alter table public.reward_transactions enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated using (id=(select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated using (id=(select auth.uid())) with check (id=(select auth.uid()));
create policy sites_select_own on public.sites for select to authenticated using (user_id=(select auth.uid()));
create policy sites_insert_own on public.sites for insert to authenticated with check (user_id=(select auth.uid()));
create policy sites_update_own on public.sites for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
create policy sites_delete_own on public.sites for delete to authenticated using (user_id=(select auth.uid()));
create policy sessions_select_own on public.sessions for select to authenticated using (user_id=(select auth.uid()));
create policy rewards_select_own on public.reward_transactions for select to authenticated using (user_id=(select auth.uid()));
create policy rewards_insert_own on public.reward_transactions for insert to authenticated with check (
 user_id=(select auth.uid()) and exists(select 1 from public.sites s where s.id=site_id and s.user_id=(select auth.uid())));
create policy rewards_update_own on public.reward_transactions for update to authenticated using (user_id=(select auth.uid())) with check (
 user_id=(select auth.uid()) and exists(select 1 from public.sites s where s.id=site_id and s.user_id=(select auth.uid())));
create policy rewards_delete_own on public.reward_transactions for delete to authenticated using (user_id=(select auth.uid()));
create policy audit_select_own on public.audit_events for select to authenticated using (user_id=(select auth.uid()));

create or replace function public.start_session(p_site_id uuid)
returns public.sessions language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_session public.sessions;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if not exists(select 1 from public.sites s where s.id=p_site_id and s.user_id=v_user) then raise exception 'Site not found' using errcode='P0002'; end if;
 insert into public.sessions(user_id,site_id,status,started_at,last_resumed_at)
 values(v_user,p_site_id,'active',now(),now()) returning * into v_session;
 insert into public.audit_events(user_id,event_type,entity_type,entity_id) values(v_user,'session.started','session',v_session.id);
 return v_session;
end; $$;

create or replace function public.pause_session(p_session_id uuid)
returns public.sessions language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_session public.sessions;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='28000'; end if;
 select * into v_session from public.sessions where id=p_session_id and user_id=v_user for update;
 if not found then raise exception 'Session not found' using errcode='P0002'; end if;
 if v_session.status<>'active' then raise exception 'Only active sessions can be paused' using errcode='22023'; end if;
 update public.sessions set status='paused',
 elapsed_seconds=elapsed_seconds+greatest(0,floor(extract(epoch from(now()-last_resumed_at)))::bigint),last_resumed_at=null
 where id=p_session_id returning * into v_session;
 insert into public.audit_events(user_id,event_type,entity_type,entity_id) values(v_user,'session.paused','session',v_session.id);
 return v_session;
end; $$;

create or replace function public.resume_session(p_session_id uuid)
returns public.sessions language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_session public.sessions;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='28000'; end if;
 select * into v_session from public.sessions where id=p_session_id and user_id=v_user for update;
 if not found then raise exception 'Session not found' using errcode='P0002'; end if;
 if v_session.status<>'paused' then raise exception 'Only paused sessions can be resumed' using errcode='22023'; end if;
 update public.sessions set status='active',last_resumed_at=now() where id=p_session_id returning * into v_session;
 insert into public.audit_events(user_id,event_type,entity_type,entity_id) values(v_user,'session.resumed','session',v_session.id);
 return v_session;
end; $$;

create or replace function public.finish_session(p_session_id uuid)
returns public.sessions language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_session public.sessions;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='28000'; end if;
 select * into v_session from public.sessions where id=p_session_id and user_id=v_user for update;
 if not found then raise exception 'Session not found' using errcode='P0002'; end if;
 if v_session.status='completed' then raise exception 'Session already completed' using errcode='22023'; end if;
 update public.sessions set elapsed_seconds=elapsed_seconds+case when status='active'
 then greatest(0,floor(extract(epoch from(now()-last_resumed_at)))::bigint) else 0 end,
 status='completed',last_resumed_at=null,finished_at=now()
 where id=p_session_id returning * into v_session;
 insert into public.audit_events(user_id,event_type,entity_type,entity_id,details)
 values(v_user,'session.completed','session',v_session.id,jsonb_build_object('elapsed_seconds',v_session.elapsed_seconds));
 return v_session;
end; $$;

revoke all on function public.start_session(uuid) from public;
revoke all on function public.pause_session(uuid) from public;
revoke all on function public.resume_session(uuid) from public;
revoke all on function public.finish_session(uuid) from public, anon;
revoke all on function public.pause_session(uuid) from public, anon;
revoke all on function public.resume_session(uuid) from public, anon;
revoke all on function public.finish_session(uuid) from public, anon;
grant execute on function public.start_session(uuid) to authenticated;
grant execute on function public.pause_session(uuid) to authenticated;
grant execute on function public.resume_session(uuid) to authenticated;
grant execute on function public.finish_session(uuid) to authenticated;
grant select,insert,update,delete on public.sites to authenticated;
grant select on public.sessions to authenticated;
grant select,insert,update,delete on public.reward_transactions to authenticated;
grant select on public.profiles to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant select on public.audit_events to authenticated;
commit;

begin;
select plan(12);
create temp table panel_test_results(test_name text, passed boolean);
grant insert on panel_test_results to authenticated;

-- Disposable fixture users; the enclosing transaction is rolled back.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
values
('11111111-1111-4111-8111-111111111111','authenticated','authenticated','panel-test-a@example.invalid','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now(),false,false),
('22222222-2222-4222-8222-222222222222','authenticated','authenticated','panel-test-b@example.invalid','',now(),'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now(),false,false);

set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
insert into public.sites(id,user_id,name,url) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','RLS test site','https://example.invalid');
insert into panel_test_results select 'A can read own site',count(*)=1 from public.sites where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$ declare s public.sessions; begin
 s:=public.start_session('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 insert into panel_test_results values('Owner can start session',s.status='active');
 perform set_config('paneltest.session_id',s.id::text,true);
 s:=public.pause_session(s.id);
 insert into panel_test_results values('Owner can pause session',s.status='paused');
 s:=public.resume_session(s.id);
 insert into panel_test_results values('Owner can resume session',s.status='active');
 s:=public.finish_session(s.id);
 insert into panel_test_results values('Owner can finish session',s.status='completed' and s.finished_at is not null);
end $$;

insert into public.reward_transactions(site_id,kind,amount,currency,status)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','reward',12.5,'USD','confirmed');
insert into panel_test_results select 'Owner can create reward',count(*)=1
from public.reward_transactions where site_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and kind='reward';

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
insert into panel_test_results select 'B cannot read A site',count(*)=0 from public.sites where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.sites set name='unauthorized change' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into panel_test_results select 'B cannot update A site',count(*)=0 from public.sites where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into panel_test_results select 'B cannot read A session',count(*)=0 from public.sessions where id=current_setting('paneltest.session_id')::uuid;
insert into panel_test_results select 'B cannot read A reward',count(*)=0 from public.reward_transactions where site_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$ begin
 perform public.pause_session(current_setting('paneltest.session_id')::uuid);
 insert into panel_test_results values('B cannot pause A session',false);
 exception when sqlstate 'P0002' then
 insert into panel_test_results values('B cannot pause A session',true);
end $$;

do $$ begin
 insert into public.reward_transactions(site_id,kind,amount) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','reward',1);
 insert into panel_test_results values('B cannot create reward for A site',false);
 exception when insufficient_privilege then
 insert into panel_test_results values('B cannot create reward for A site',true);
end $$;

reset role;
select ok(passed,test_name) from panel_test_results order by test_name;
select * from finish();
rollback;

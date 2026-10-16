-- Explicitly remove direct anon access to SECURITY DEFINER session RPCs.
-- These functions check auth.uid() and verify the session/site belongs to the caller.
begin;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.start_session(uuid) from public, anon;
revoke all on function public.pause_session(uuid) from public, anon;
revoke all on function public.resume_session(uuid) from public, anon;
revoke all on function public.finish_session(uuid) from public, anon;
grant execute on function public.start_session(uuid) to authenticated;
grant execute on function public.pause_session(uuid) to authenticated;
grant execute on function public.resume_session(uuid) to authenticated;
grant execute on function public.finish_session(uuid) to authenticated;
commit;

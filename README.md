# Panel 2.0 — Supabase backend

This repository includes the first database/backend foundation for a multi-user site and reward tracker.

## Architecture
- Supabase Auth provides separate user accounts.
- PostgreSQL stores profiles, sites, sessions, reward/fee/payout transactions, and audit events.
- Row Level Security (RLS) restricts each user to their own records.
- Session state transitions run through PostgreSQL RPCs with server timestamps.
- The browser must use only the project URL and publishable/anon key. Never expose or commit the service-role key.

## Files
- supabase/migrations/20261017000000_initial_schema.sql — schema, constraints, indexes, RLS, session RPCs.
- supabase/tests/database.test.sql — pgTAP structural smoke tests.
- .env.example — blank configuration template.

## Setup
1. Create a project at https://supabase.com/dashboard.
2. Install the Supabase CLI and Docker; run: supabase login
3. Link this repository: supabase link --project-ref YOUR_PROJECT_REF
4. Review and apply the migration: supabase db push
5. Configure allowed redirect URLs and sign-in methods in Supabase Authentication settings.
6. Run local tests: supabase start, then supabase test db.
7. Add the project URL and publishable/anon key to frontend runtime configuration. Never put a service-role key in public code.

## Data model
- profiles: display name for each auth user.
- sites: site metadata, status, notes and wallet label. Do not store private keys or seed phrases.
- sessions: server-timestamped sessions with pause/resume accounting.
- reward_transactions: reward, fee, payout and adjustment entries.
- audit_events: audit trail for session transitions.

Amounts are positive values. Transaction kind defines how an entry is interpreted. A reward entry does not prove that a site paid; mark a payout confirmed only after manual or external verification.

## Supabase JS v2 API examples
~~~js
// Read the signed-in user's sites; RLS scopes the results.
const { data, error } = await supabase
  .from('sites').select('*').order('updated_at', { ascending: false });

// Add a site. user_id defaults to auth.uid().
const { data: site, error } = await supabase
  .from('sites')
  .insert({ name: 'Example', url: 'https://example.com' })
  .select().single();

// Session transitions use trusted server timestamps.
const { data: session, error } = await supabase.rpc('start_session', {
  p_site_id: site.id
});
await supabase.rpc('pause_session', { p_session_id: session.id });
await supabase.rpc('resume_session', { p_session_id: session.id });
await supabase.rpc('finish_session', { p_session_id: session.id });

// Add a reward record. Never store private keys or seed phrases.
await supabase.from('reward_transactions').insert({
  site_id: site.id, kind: 'reward', amount: 0.25,
  currency: 'USD', status: 'pending', notes: 'Recorded manually'
});
~~~

## Important status
This is the database/API foundation, not a completed production deployment. The existing index.html has not yet been connected to Supabase authentication and queries. No credentials are committed. End-to-end tests require a Supabase project and local Supabase CLI/Docker. Before production, test signup/login, cross-user isolation, CRUD, session transitions and reward transactions, and configure backups, email verification, rate limits and monitoring.

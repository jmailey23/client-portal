-- client-portal schema.
--
-- The CRM is the system of record for the search itself. Postgres holds what
-- the CRM does not: who has a portal account, which CRM contact that account
-- is, and the welcome email log. The rules that matter live here, not in the
-- browser:
--
--   * a client sees their own row and nobody else's
--   * an agent sees the clients assigned to them; the owner sees everyone
--   * a client can edit their profile, but not the fields that decide what
--     they are shown (their stage, their CRM contact, their agent)
--   * accounts are created by the server after the CRM check, never by a
--     client inserting a row for themselves
--   * a deal is welcomed once, and a person is welcomed once, ever
--
-- Portable Postgres. On Supabase, replace app_uid() with auth.uid().


create table staff (
  id       uuid primary key default gen_random_uuid(),
  name     text not null,
  role     text not null check (role in ('owner', 'agent')),
  auth_uid uuid unique
);

create table clients (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique,                 -- the auth account
  email          text not null unique check (email = lower(email)),
  first_name     text not null,
  last_name      text,
  neighborhood   text,
  crm_contact_id text not null,                        -- set by signup, from the CRM check
  stage          text not null default 'lead',
  agent_id       uuid references staff,
  created_at     timestamptz not null default now()
);
comment on column clients.crm_contact_id is 'The CRM contact this account was verified against at signup.';

create table welcome_emails_log (
  id            uuid primary key default gen_random_uuid(),
  deal_id       text not null,
  contact_email text,
  status        text not null check (status in ('sent', 'skipped', 'error')),
  message_id    text,
  error         text,
  created_at    timestamptz not null default now()
);
create index welcome_log_deal on welcome_emails_log (deal_id);

-- The job that sends these runs every few minutes and can overlap itself.
-- Two runs racing on one deal: the second insert fails, nobody gets two emails.
create unique index welcome_once_per_deal on welcome_emails_log (deal_id)
  where status in ('sent', 'skipped');
-- A returning client gets a new deal, not a second welcome.
create unique index welcome_once_per_person on welcome_emails_log (lower(contact_email))
  where status = 'sent';

-- ── who is asking ────────────────────────────────────────────────────────

create function app_uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.uid', true), '')::uuid
$$;

create function staff_me() returns staff language sql stable security definer as $$
  select * from staff where auth_uid = app_uid()
$$;

-- ── row level security ───────────────────────────────────────────────────

alter table staff              enable row level security;
alter table clients            enable row level security;
alter table welcome_emails_log enable row level security;

create policy staff_read on staff for select using ((staff_me()).id is not null);

create policy clients_self  on clients for select using (user_id = app_uid());
create policy clients_owner on clients for select using ((staff_me()).role = 'owner');
create policy clients_agent on clients for select using (agent_id = (staff_me()).id);

create policy clients_self_update  on clients for update
  using (user_id = app_uid()) with check (user_id = app_uid());
create policy clients_owner_update on clients for update using ((staff_me()).role = 'owner');

-- No insert policy on clients and none on the log: both are written by the
-- server, which checks the CRM first. A signed in browser cannot create an
-- account row for itself or forge a "sent" record.

-- A client edits their name and neighborhood. What they are shown is decided
-- by the brokerage. (No uid at all is the server itself, e.g. a CRM sync.)
create function guard_client_update() returns trigger language plpgsql as $$
begin
  if app_uid() is not null and (staff_me()).id is null and (
       new.stage          is distinct from old.stage
    or new.crm_contact_id is distinct from old.crm_contact_id
    or new.agent_id       is distinct from old.agent_id
    or new.email          is distinct from old.email
    or new.user_id        is distinct from old.user_id) then
    raise exception 'clients can only edit their own profile fields';
  end if;
  return new;
end $$;
create trigger clients_guard before update on clients
  for each row execute function guard_client_update();

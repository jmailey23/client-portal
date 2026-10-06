/**
 * The schema against a real Postgres (PGlite, in process). Policies are
 * checked as an ordinary role, because a superuser walks straight past RLS.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const ids = {
  rosa: "00000000-0000-0000-0000-00000000000a", // owner
  jay: "00000000-0000-0000-0000-00000000000b", // agent
  ava: "00000000-0000-0000-0000-0000000000c1",
  mara: "00000000-0000-0000-0000-0000000000c2",
};

async function as(uid: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; set app.uid = '${uid ?? ""}'; set role app_user;`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}

before(async () => {
  await db.exec(readFileSync(new URL("../schema/001_portal.sql", import.meta.url), "utf8"));
  await db.exec(`
    create role app_user nologin;
    grant usage on schema public to app_user;
    grant select, insert, update, delete on all tables in schema public to app_user;
    grant execute on all functions in schema public to app_user;

    insert into staff (id, name, role, auth_uid) values
      ('${ids.rosa}', 'Rosa', 'owner', '${ids.rosa}'),
      ('${ids.jay}',  'Jay',  'agent', '${ids.jay}');
    insert into clients (user_id, email, first_name, crm_contact_id, agent_id) values
      ('${ids.ava}',  'ava.chen@example.com',  'Ava',  'c-101', '${ids.jay}'),
      ('${ids.mara}', 'mara.lind@example.com', 'Mara', 'c-104', '${ids.rosa}');
    insert into welcome_emails_log (deal_id, contact_email, status, message_id)
      values ('d-201', 'ava.chen@example.com', 'sent', 'msg-1');
  `);
});

const names = (r: { rows: unknown[] }) => r.rows.map((x: any) => x.first_name).sort();

test("a client sees only their own row", async () => {
  assert.deepEqual(names(await as(ids.ava, "select first_name from clients")), ["Ava"]);
  assert.deepEqual(names(await as(ids.mara, "select first_name from clients")), ["Mara"]);
});

test("an agent sees their clients; the owner sees everyone", async () => {
  assert.deepEqual(names(await as(ids.jay, "select first_name from clients")), ["Ava"]);
  assert.deepEqual(names(await as(ids.rosa, "select first_name from clients")), ["Ava", "Mara"]);
});

test("nobody signed in sees nothing", async () => {
  assert.equal((await as(null, "select * from clients")).rows.length, 0);
});

test("a client edits their profile, not what they are shown", async () => {
  await as(ids.ava, "update clients set neighborhood = 'Uptown' where user_id = $1", [ids.ava]);
  await assert.rejects(as(ids.ava, "update clients set stage = 'moved_in'"), /only edit their own profile/);
  await assert.rejects(as(ids.ava, "update clients set crm_contact_id = 'c-104'"), /only edit their own profile/);
  const r = await db.query<{ neighborhood: string; stage: string }>("select neighborhood, stage from clients where user_id = $1", [ids.ava]);
  assert.deepEqual(r.rows[0], { neighborhood: "Uptown", stage: "lead" });
});

test("a client cannot touch someone else's row", async () => {
  const r = await as(ids.ava, "update clients set neighborhood = 'x' where user_id = $1", [ids.mara]);
  assert.equal(r.affectedRows, 0);
});

test("accounts are created by the server, not by a signed in browser", async () => {
  await assert.rejects(
    as(ids.ava, "insert into clients (user_id, email, first_name, crm_contact_id) values (gen_random_uuid(), 'new@example.com', 'N', 'c-999')"),
    /row-level security/,
  );
});

test("the welcome log is server only: invisible and unwritable from the browser", async () => {
  assert.equal((await as(ids.rosa, "select * from welcome_emails_log")).rows.length, 0);
  await assert.rejects(
    as(ids.ava, "insert into welcome_emails_log (deal_id, status) values ('d-999', 'sent')"),
    /row-level security/,
  );
});

test("a deal is welcomed once and a person is welcomed once, even if two runs race", async () => {
  await assert.rejects(
    db.exec("insert into welcome_emails_log (deal_id, contact_email, status) values ('d-201', 'other@example.com', 'sent')"),
    /welcome_once_per_deal/,
  );
  await assert.rejects(
    db.exec("insert into welcome_emails_log (deal_id, contact_email, status) values ('d-777', 'AVA.CHEN@example.com', 'sent')"),
    /welcome_once_per_person/,
  );
  // Errors are retries, and there can be many.
  await db.exec(`insert into welcome_emails_log (deal_id, status, error) values ('d-202', 'error', 'no email'), ('d-202', 'error', 'no email')`);
});

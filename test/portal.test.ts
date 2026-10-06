import assert from "node:assert/strict";
import { test } from "node:test";
import { StubVerifier } from "../src/auth.ts";
import { FakeCrm, HubSpotCrm } from "../src/crm.ts";
import { CLIENT_CONTACT_FIELDS, CLIENT_DEAL_FIELDS, createPortal, type Dashboard } from "../src/portal.ts";
import { createSignup, MemoryAccounts } from "../src/signup.ts";
import { contacts, deals, owners, tokens } from "../demo/fixtures.ts";

const setup = () => {
  const crm = new FakeCrm({ contacts, deals, owners });
  return { crm, portal: createPortal({ crm, verifier: new StubVerifier(tokens) }) };
};
const dashboard = async (token: string, body?: Record<string, unknown>) =>
  setup().portal.handle({ action: "dashboard", authorization: `Bearer ${token}`, body });

test("no token or a bad token gets nothing", async () => {
  const { portal } = setup();
  assert.equal((await portal.handle({ action: "dashboard" })).status, 401);
  assert.equal((await portal.handle({ action: "dashboard", authorization: "Bearer forged" })).status, 401);
  assert.equal((await portal.handle({ action: "dashboard", authorization: "token-ava" })).status, 401, "not a bearer header");
});

test("a client gets their own dashboard", async () => {
  const r = await dashboard("token-ava");
  const d = r.body as Dashboard;
  assert.equal(r.status, 200);
  assert.equal(d.client.firstname, "Ava");
  assert.equal(d.phase, "searching");
  assert.equal(d.agent, "Jay Patel");
  assert.equal(d.tours.days[0].tours.length, 3);
});

test("the identity comes from the token, never the request body", async () => {
  const r = await dashboard("token-ava", { email: "mara.lind@example.com", contactId: "c-104" });
  assert.equal((r.body as Dashboard).client.firstname, "Ava");
});

test("only allowlisted fields leave the server", async () => {
  const d = (await dashboard("token-ava")).body as Dashboard;
  for (const k of Object.keys(d.client)) assert.ok((CLIENT_CONTACT_FIELDS as readonly string[]).includes(k), k);
  for (const k of Object.keys(d.deal ?? {})) assert.ok((CLIENT_DEAL_FIELDS as readonly string[]).includes(k), k);
  const wire = JSON.stringify(d);
  for (const secret of ["50%", "Budget can stretch", "Prefers texts", "214-555", "o-jay"]) {
    assert.ok(!wire.includes(secret), `leaked: ${secret}`);
  }
});

test("a signed in account with no CRM contact gets a 404, not someone else's data", async () => {
  assert.equal((await dashboard("token-nobody")).status, 404);
});

test("verifyEmail answers yes or no and nothing else", async () => {
  const { portal } = setup();
  assert.deepEqual((await portal.handle({ action: "verifyEmail", body: { email: " BEN.OKORO@example.com " } })).body, { exists: true });
  assert.deepEqual((await portal.handle({ action: "verifyEmail", body: { email: "x@example.com" } })).body, { exists: false });
  assert.equal((await portal.handle({ action: "verifyEmail", body: {} })).status, 400);
});

test("a CRM outage is a 502 with no CRM detail in it", async () => {
  const crm = new FakeCrm({ contacts, deals, owners });
  crm.dealsForContact = async () => {
    throw new Error("HubSpot 500: property commission_rate on deal d-201");
  };
  const original = console.error;
  console.error = () => {};
  try {
    const r = await createPortal({ crm, verifier: new StubVerifier(tokens) }).handle({ action: "dashboard", authorization: "Bearer token-ava" });
    assert.equal(r.status, 502);
    assert.ok(!JSON.stringify(r.body).includes("commission"));
  } finally {
    console.error = original;
  }
});

test("signup: CRM contacts only, once each, linked to their contact", async () => {
  const accounts = new MemoryAccounts();
  const signUp = createSignup({ crm: new FakeCrm({ contacts, deals, owners }), accounts });
  assert.deepEqual(await signUp({ email: "stranger@example.com", password: "long enough", firstName: "S" }), { ok: false, reason: "not_a_client" });
  const ok = await signUp({ email: " Ava.Chen@Example.com", password: "long enough", firstName: "Ava" });
  assert.ok(ok.ok && ok.account.crmContactId === "c-101" && ok.account.email === "ava.chen@example.com");
  assert.deepEqual(await signUp({ email: "ava.chen@example.com", password: "long enough", firstName: "Ava" }), { ok: false, reason: "already_registered" });
  assert.equal(accounts.accounts.length, 1);
});

test("signup: a contact with a blank email does not match a blank email", async () => {
  const signUp = createSignup({ crm: new FakeCrm({ contacts, deals, owners }), accounts: new MemoryAccounts() });
  assert.deepEqual(await signUp({ email: "  ", password: "long enough", firstName: "Dee" }), { ok: false, reason: "invalid" });
});

test("the HubSpot adapter carries the token server side and searches by the normalized email", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ results: [{ id: "1", properties: { email: "ava.chen@example.com" } }] }));
  }) as unknown as typeof fetch;
  const crm = new HubSpotCrm({ token: "pat-secret", fetch: fakeFetch });
  const c = await crm.findContactByEmail(" Ava.Chen@example.com ");
  assert.equal(c?.id, "1");
  assert.equal(calls[0].url, "https://api.hubapi.com/crm/v3/objects/contacts/search");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer pat-secret");
  assert.match(String(calls[0].init.body), /"value":"ava.chen@example.com"/);
});

/**
 * npm run demo    the whole portal against an in-memory CRM: no network, no keys
 */
import { StubVerifier } from "../src/auth.ts";
import { FakeCrm } from "../src/crm.ts";
import { createPortal, type Dashboard } from "../src/portal.ts";
import { createSignup, MemoryAccounts } from "../src/signup.ts";
import { createWelcome, MemoryLog, MemoryMailer } from "../src/welcome.ts";
import { contacts, deals, owners, tokens } from "./fixtures.ts";

const crm = new FakeCrm({ contacts, deals, owners });
const portal = createPortal({ crm, verifier: new StubVerifier(tokens) });

console.log("\n1. Signup is for clients only");
const signUp = createSignup({ crm, accounts: new MemoryAccounts() });
for (const email of ["Ava.Chen@example.com", "curious.visitor@example.com", "ava.chen@example.com"]) {
  const r = await signUp({ email, password: "correct horse", firstName: "Ava" });
  console.log(`  ${email.padEnd(30)}${r.ok ? `account ${r.account.userId}, CRM contact ${r.account.crmContactId}` : `refused: ${r.reason}`}`);
}

console.log("\n2. The CRM proxy");
const show = async (label: string, req: Parameters<typeof portal.handle>[0]) => {
  const r = await portal.handle(req);
  const b = r.body as Dashboard & { error?: string };
  console.log(`  ${label.padEnd(36)}${r.status}  ${r.status === 200 ? `${b.client.firstname}, ${b.phase}, agent ${b.agent ?? "none"}` : b.error}`);
  return r;
};
await show("no token", { action: "dashboard" });
await show("forged token", { action: "dashboard", authorization: "Bearer made-up" });
await show("signed in, not in the CRM", { action: "dashboard", authorization: "Bearer token-nobody" });
const ava = await show("Ava", { action: "dashboard", authorization: "Bearer token-ava" });
await show("Ava, asking for Mara by email", {
  action: "dashboard", authorization: "Bearer token-ava", body: { email: "mara.lind@example.com", contactId: "c-104" },
});
await show("Mara", { action: "dashboard", authorization: "Bearer token-mara" });
const d = ava.body as Dashboard;
const returned = [...Object.keys(d.client), ...Object.keys(d.deal ?? {})];
const readOnServer = ["dealstage", "createdate", "tour_log", "hubspot_owner_id"];
const held = [...new Set([...Object.keys(contacts[0].properties), ...Object.keys(deals[0].properties)])]
  .filter((k) => !returned.includes(k) && !readOnServer.includes(k));
console.log(`  Ava is shown:          ${returned.join(", ")}`);
console.log(`  used on the server:    ${readOnServer.join(", ")}`);
console.log(`  never sent:            ${held.join(", ")}`);
for (const email of ["ben.okoro@example.com", "someone@example.com"]) {
  const r = await portal.handle({ action: "verifyEmail", body: { email } });
  console.log(`  verifyEmail ${email.padEnd(24)}${JSON.stringify(r.body)}`);
}

console.log("\n3. Ava's tour notes, as her broker typed them, and as cards");
console.log(deals[0].properties.tour_log!.split("\n").map((l) => `  | ${l}`).join("\n"));
for (const day of d.tours.days) {
  console.log(`  ${day.date}`);
  for (const t of day.tours) console.log(`    ${t.time.padEnd(8)}${t.name}${t.note ? `  (${t.note})` : ""}`);
}
for (const n of d.tours.notes) console.log(`    note: ${n}`);

console.log("\n4. Welcome emails, one scheduled run at a time");
const log = new MemoryLog();
// Ben was welcomed on last year's deal.
await log.add({ dealId: "d-203", contactEmail: "ben.okoro@example.com", status: "sent", messageId: "msg-2025", error: null, at: new Date("2025-03-02T16:00:00Z") });
const mailer = new MemoryMailer();
let clock = new Date("2026-10-05T14:00:00Z");
const welcome = createWelcome({
  crm, log, mailer, alertTo: ["rosa@northline.example"], signupUrl: "https://portal.northline.example/#signup",
  brokerage: "Northline Locating", now: () => clock,
});
const run = async (label: string) => {
  const before = mailer.sent.length;
  const results = (await welcome.check()).filter((r) => r.outcome !== "already_sent");
  const time = clock.toISOString().slice(11, 19);
  console.log(`  ${time}  ${label}`);
  if (!results.length) console.log("            nothing new");
  for (const r of results) console.log(`            ${r.dealId}  ${r.outcome}${r.error ? `: ${r.error}` : ""}`);
  for (const m of mailer.sent.slice(before)) console.log(`            > to ${m.to.join(", ")}: "${m.subject}"`);
};
await run("first run");
clock = new Date(+clock + 30_000);
await run("30 seconds later");
crm.contacts.find((c) => c.id === "c-103")!.properties.email = "dee.alvarez@example.com";
clock = new Date(+clock + 90_000);
await run("Dee's email added in the CRM");
clock = new Date(+clock + 120_000);
await run("next run");

const sent = log.rows.filter((r) => r.status === "sent" && r.at > new Date("2026-01-01"));
const alerts = mailer.sent.filter((m) => m.subject.startsWith("Welcome email failed")).length;
const dupes = sent.length - new Set(sent.map((r) => r.contactEmail)).size;
const skipped = log.rows.filter((r) => r.status === "skipped").length;
console.log(`\n${sent.length} welcomes sent, ${skipped} skipped, ${alerts} alert, ${dupes} duplicates\n`);
console.log("The first welcome, as sent:\n");
console.log(mailer.sent[0].text.split("\n").map((l) => `  ${l}`).join("\n"));

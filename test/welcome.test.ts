import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeCrm } from "../src/crm.ts";
import { createWelcome, MemoryLog, MemoryMailer, type Mailer } from "../src/welcome.ts";
import { contacts, deals, owners } from "../demo/fixtures.ts";

const T0 = new Date("2026-10-05T14:00:00Z");
const min = (n: number) => new Date(+T0 + n * 60_000);

const setup = (mailer: Mailer = new MemoryMailer()) => {
  const crm = new FakeCrm({ contacts, deals, owners });
  const log = new MemoryLog();
  let clock = T0;
  const welcome = createWelcome({
    crm, log, mailer, alertTo: ["owner@northline.example"], signupUrl: "https://portal.example/#signup",
    brokerage: "Northline Locating", now: () => clock,
  });
  return { crm, log, welcome, setClock: (d: Date) => (clock = d) };
};

const outcome = (results: { dealId: string; outcome: string }[], dealId: string) =>
  results.find((r) => r.dealId === dealId)?.outcome;

test("each deal in a welcome stage is emailed once, however often the job runs", async () => {
  const mailer = new MemoryMailer();
  const { welcome, setClock } = setup(mailer);
  await welcome.check();
  setClock(min(5));
  await welcome.check();
  setClock(min(60));
  await welcome.check();
  const welcomes = mailer.sent.filter((m) => m.subject === "Your search is ready");
  assert.deepEqual(welcomes.map((m) => m.to[0]).sort(), ["ava.chen@example.com", "ben.okoro@example.com"]);
});

test("a returning client is skipped, and the skip is logged so it is decided once", async () => {
  const mailer = new MemoryMailer();
  const { log, welcome } = setup(mailer);
  await log.add({ dealId: "d-203", contactEmail: "Ben.Okoro@example.com", status: "sent", messageId: "m0", error: null, at: new Date("2025-03-02") });
  assert.equal(outcome(await welcome.check(), "d-204"), "skipped_returning_client");
  assert.equal(outcome(await welcome.check(), "d-204"), "already_sent");
  assert.ok(!mailer.sent.some((m) => m.to.includes("ben.okoro@example.com")));
});

test("a failure alerts once, retries fast, then slow, then gives up", async () => {
  const mailer = new MemoryMailer();
  const { welcome, setClock } = setup(mailer);
  const alerts = () => mailer.sent.filter((m) => m.subject.startsWith("Welcome email failed")).length;

  assert.equal(outcome(await welcome.check(), "d-202"), "error");
  setClock(min(0.5));
  assert.equal(outcome(await welcome.check(), "d-202"), "cooling_down");
  setClock(min(1));
  assert.equal(outcome(await welcome.check(), "d-202"), "error", "rapid retry after a minute");
  setClock(min(15));
  assert.equal(outcome(await welcome.check(), "d-202"), "error");
  setClock(min(20));
  assert.equal(outcome(await welcome.check(), "d-202"), "cooling_down", "past ten minutes, retries every ten");
  setClock(min(71));
  assert.equal(outcome(await welcome.check(), "d-202"), "gave_up");
  assert.equal(alerts(), 1, "three failures, one alert");
});

test("fixing the record in the CRM is enough; the next run sends", async () => {
  const mailer = new MemoryMailer();
  const { crm, welcome, setClock } = setup(mailer);
  await welcome.check();
  crm.contacts.find((c) => c.id === "c-103")!.properties.email = "dee@example.com";
  setClock(min(2));
  assert.equal(outcome(await welcome.check(), "d-202"), "sent");
  assert.ok(mailer.sent.some((m) => m.to[0] === "dee@example.com"));
});

test("a provider failure is logged and retried, never recorded as sent", async () => {
  let down = true;
  const flaky: Mailer = {
    send: async (e) => {
      if (down && e.subject === "Your search is ready") throw new Error("Resend 503");
      return { id: "ok" };
    },
  };
  const { log, welcome, setClock } = setup(flaky);
  await welcome.check();
  assert.equal(log.rows.filter((r) => r.status === "sent").length, 0);
  down = false;
  setClock(min(2));
  await welcome.check();
  assert.equal(log.rows.filter((r) => r.status === "sent").length, 2);
});

/**
 * "Your search is ready": the email that invites a client to the portal.
 *
 * It goes out when the broker moves a deal into a "list sent" stage in the
 * CRM, which is the moment the client has something to look at. A scheduled
 * job calls check() every couple of minutes. Every decision is written to a
 * log table, and the log is what makes the job safe to run again and again:
 *
 *   deal already sent or skipped    ->  nothing
 *   client welcomed on an old deal  ->  skipped and logged (a returning client
 *                                       is never welcomed twice)
 *   send fails                      ->  logged as an error; the broker and the
 *                                       developer are alerted once, on the
 *                                       first failure only
 *   failed before                   ->  retried every minute for 10 minutes,
 *                                       then every 10 minutes, then given up
 *                                       at 70 minutes or 20 attempts
 *
 * The give up point is the broker's, not the code's: if a client has not
 * heard anything within the hour she sends the search another way, and a
 * welcome arriving after that only confuses them.
 */
import { normalizeEmail, type Crm } from "./crm.ts";

export const WELCOME_STAGES = ["list_sent_asap", "list_sent_30", "list_sent_60"];

const RAPID_WINDOW_MIN = 10;
const RAPID_COOLDOWN_MIN = 1;
const SLOW_COOLDOWN_MIN = 10;
const GIVE_UP_MIN = 70;
const MAX_ATTEMPTS = 20;

export type LogStatus = "sent" | "skipped" | "error";

export interface LogRow {
  dealId: string;
  contactEmail: string | null;
  status: LogStatus;
  messageId: string | null;
  error: string | null;
  at: Date;
}

/** schema/001_portal.sql has the same table, with the "once per deal" rule as a unique index. */
export interface WelcomeLog {
  forDeal(dealId: string): Promise<LogRow[]>;
  sentTo(email: string): Promise<LogRow | null>;
  add(row: LogRow): Promise<void>;
}

export class MemoryLog implements WelcomeLog {
  readonly rows: LogRow[] = [];
  async forDeal(dealId: string) {
    return this.rows.filter((r) => r.dealId === dealId);
  }
  async sentTo(email: string) {
    return this.rows.find((r) => r.status === "sent" && normalizeEmail(r.contactEmail ?? "") === normalizeEmail(email)) ?? null;
  }
  async add(row: LogRow) {
    this.rows.push(row);
  }
}

export interface Email {
  to: string[];
  subject: string;
  text: string;
}

export interface Mailer {
  send(email: Email): Promise<{ id: string }>;
}

/** For running without an email provider. Records what would have been sent. */
export class MemoryMailer implements Mailer {
  readonly sent: Email[] = [];
  async send(email: Email) {
    this.sent.push(email);
    return { id: `msg-${this.sent.length}` };
  }
}

export class ResendMailer implements Mailer {
  constructor(
    private from: string,
    private apiKey = process.env.RESEND_API_KEY ?? "",
    private fetchImpl: typeof fetch = fetch,
  ) {}
  async send(email: Email) {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ from: this.from, ...email }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    return (await res.json()) as { id: string };
  }
}

export interface WelcomeDeps {
  crm: Crm;
  log: WelcomeLog;
  mailer: Mailer;
  /** Who hears about a failed send. */
  alertTo: string[];
  signupUrl: string;
  brokerage: string;
  now?: () => Date;
}

export type DealOutcome =
  | "sent" | "already_sent" | "skipped_returning_client" | "cooling_down" | "gave_up" | "error";

export function welcomeEmail(firstName: string, email: string, signupUrl: string, brokerage: string): Email {
  return {
    to: [email],
    subject: `Your search is ready`,
    text:
      `Hi ${firstName || "there"},\n\n` +
      `Your search is ready. Create your account to see it, and use the email we have on file: ${email}\n\n` +
      `${signupUrl}\n\n` +
      `Your tour schedule will be there too once you start touring.\n\n${brokerage}`,
  };
}

export function createWelcome(deps: WelcomeDeps) {
  const now = deps.now ?? (() => new Date());

  async function sendForDeal(dealId: string): Promise<DealOutcome> {
    const history = await deps.log.forDeal(dealId);
    if (history.some((r) => r.status === "sent" || r.status === "skipped")) return "already_sent";

    const errors = history.filter((r) => r.status === "error").sort((a, b) => +a.at - +b.at);
    if (errors.length) {
      const mins = (from: Date) => (+now() - +from) / 60_000;
      const trying = mins(errors[0].at);
      if (trying >= GIVE_UP_MIN || errors.length >= MAX_ATTEMPTS) return "gave_up";
      const cooldown = trying < RAPID_WINDOW_MIN ? RAPID_COOLDOWN_MIN : SLOW_COOLDOWN_MIN;
      if (mins(errors[errors.length - 1].at) < cooldown) return "cooling_down";
    }

    const contact = await deps.crm.contactForDeal(dealId);
    if (!contact) throw new Error("no contact on the deal");
    const email = contact.properties.email?.trim();
    if (!email) throw new Error("the contact on the deal has no email");

    const earlier = await deps.log.sentTo(email);
    if (earlier) {
      // Logged once, so the job stops reconsidering this deal.
      await deps.log.add({
        dealId, contactEmail: email, status: "skipped", messageId: null,
        error: `returning client, welcomed on deal ${earlier.dealId}`, at: now(),
      });
      return "skipped_returning_client";
    }

    const { id } = await deps.mailer.send(
      welcomeEmail(contact.properties.firstname ?? "", email, deps.signupUrl, deps.brokerage),
    );
    await deps.log.add({ dealId, contactEmail: email, status: "sent", messageId: id, error: null, at: now() });
    return "sent";
  }

  /** One scheduled run: every deal in a welcome stage that has not been settled. */
  async function check(): Promise<{ dealId: string; outcome: DealOutcome; error?: string }[]> {
    const results: { dealId: string; outcome: DealOutcome; error?: string }[] = [];
    for (const deal of await deps.crm.dealsInStages(WELCOME_STAGES)) {
      try {
        results.push({ dealId: deal.id, outcome: await sendForDeal(deal.id) });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        const first = !(await deps.log.forDeal(deal.id)).some((r) => r.status === "error");
        await deps.log.add({ dealId: deal.id, contactEmail: null, status: "error", messageId: null, error, at: now() });
        // A failure nobody hears about is the expensive kind. Once, though:
        // a retry loop that emails on every attempt gets filtered.
        if (first && deps.alertTo.length) {
          await deps.mailer
            .send({
              to: deps.alertTo,
              subject: `Welcome email failed: ${deal.properties.dealname ?? deal.id}`,
              text: `${error}\n\nFix it in the CRM and the next run retries on its own.`,
            })
            .catch(() => {});
        }
        results.push({ dealId: deal.id, outcome: "error", error });
      }
    }
    return results;
  }

  return { check, sendForDeal };
}

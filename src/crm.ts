/**
 * The CRM, behind an interface.
 *
 * The brokerage's CRM is the system of record: the broker lives in it all
 * day, and the portal is a window onto it, not a second copy. Everything here
 * runs server side. The CRM token is read from the server's environment and
 * is never sent to, or derivable by, the browser.
 *
 * FakeCrm is an in-memory stand-in so the portal, the tests and the demo run
 * with no network and no token. HubSpotCrm is the same interface over the
 * HubSpot v3 API.
 */
import type { CrmRecord } from "./types.ts";

export interface Crm {
  findContactByEmail(email: string): Promise<CrmRecord | null>;
  dealsForContact(contactId: string): Promise<CrmRecord[]>;
  dealsInStages(stages: string[]): Promise<CrmRecord[]>;
  contactForDeal(dealId: string): Promise<CrmRecord | null>;
  ownerName(ownerId: string): Promise<string | null>;
}

export const normalizeEmail = (email: string) => String(email || "").trim().toLowerCase();

export interface FakeDeal extends CrmRecord {
  contactId: string;
}

export class FakeCrm implements Crm {
  readonly contacts: CrmRecord[];
  readonly deals: FakeDeal[];
  readonly owners: Record<string, string>;

  constructor(data: { contacts: CrmRecord[]; deals: FakeDeal[]; owners: Record<string, string> }) {
    // Copies, so a test or the demo can edit a record without touching the fixtures.
    this.contacts = structuredClone(data.contacts);
    this.deals = structuredClone(data.deals);
    this.owners = { ...data.owners };
  }

  async findContactByEmail(email: string) {
    const want = normalizeEmail(email);
    return this.contacts.find((c) => want && normalizeEmail(c.properties.email ?? "") === want) ?? null;
  }
  async dealsForContact(contactId: string) {
    return this.deals.filter((d) => d.contactId === contactId);
  }
  async dealsInStages(stages: string[]) {
    return this.deals.filter((d) => stages.includes(d.properties.dealstage ?? ""));
  }
  async contactForDeal(dealId: string) {
    const deal = this.deals.find((d) => d.id === dealId);
    return (deal && this.contacts.find((c) => c.id === deal.contactId)) ?? null;
  }
  async ownerName(ownerId: string) {
    return this.owners[ownerId] ?? null;
  }
}

/** What the server reads from the CRM. Wider than what a client is shown (see portal.ts). */
const CONTACT_READ = ["email", "firstname", "lastname", "neighborhood"];
const DEAL_READ = [
  "dealname", "dealstage", "createdate", "tour_log", "top_picks", "report_link",
  "move_in_date", "rent_amount", "unit_number", "hubspot_owner_id",
];

type Fetch = typeof fetch;

export class HubSpotCrm implements Crm {
  private token: string;
  private fetch: Fetch;

  constructor(opts: { token?: string; fetch?: Fetch } = {}) {
    const token = opts.token ?? process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN is not set");
    this.token = token;
    this.fetch = opts.fetch ?? fetch;
  }

  private async call(path: string, init: RequestInit = {}) {
    const res = await this.fetch(`https://api.hubapi.com${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`HubSpot ${res.status}: ${await res.text()}`);
    return res.json() as Promise<any>;
  }

  async findContactByEmail(email: string) {
    const want = normalizeEmail(email);
    if (!want) return null;
    const data = await this.call("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: want }] }],
        properties: CONTACT_READ,
      }),
    });
    return data.results?.[0] ?? null;
  }

  async dealsForContact(contactId: string) {
    const assoc = await this.call(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}/associations/deals`);
    const inputs = (assoc.results ?? []).map((r: { id: string }) => ({ id: r.id }));
    if (!inputs.length) return [];
    const data = await this.call("/crm/v3/objects/deals/batch/read", {
      method: "POST",
      body: JSON.stringify({ inputs, properties: DEAL_READ }),
    });
    return data.results ?? [];
  }

  async dealsInStages(stages: string[]) {
    const data = await this.call("/crm/v3/objects/deals/search", {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "dealstage", operator: "IN", values: stages }] }],
        properties: ["dealname", "dealstage"],
        limit: 50,
      }),
    });
    return data.results ?? [];
  }

  async contactForDeal(dealId: string) {
    const assoc = await this.call(`/crm/v3/objects/deals/${encodeURIComponent(dealId)}/associations/contacts`);
    const id = assoc.results?.[0]?.id;
    if (!id) return null;
    return this.call(`/crm/v3/objects/contacts/${id}?properties=${CONTACT_READ.join(",")}`);
  }

  async ownerName(ownerId: string) {
    try {
      const o = await this.call(`/crm/v3/owners/${encodeURIComponent(ownerId)}`);
      return [o.firstName, o.lastName].filter(Boolean).join(" ") || null;
    } catch {
      return null; // an agent's name is decoration; never fail a dashboard over it
    }
  }
}

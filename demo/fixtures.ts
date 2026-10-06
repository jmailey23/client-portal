/**
 * Northline Locating is fictional, and so is everyone here. The shapes are
 * not: a returning client with last year's deal still closed won, a deal
 * whose contact has no email yet, and tour notes typed the way a broker
 * texts them.
 */
import type { FakeDeal } from "../src/crm.ts";
import type { CrmRecord, Identity } from "../src/types.ts";

export const owners: Record<string, string> = {
  "o-rosa": "Rosa Medina",
  "o-jay": "Jay Patel",
};

export const contacts: CrmRecord[] = [
  { id: "c-101", properties: { email: "ava.chen@example.com", firstname: "Ava", lastname: "Chen", phone: "214-555-0101", lead_source: "Instagram", internal_notes: "Budget can stretch to 2100" } },
  { id: "c-102", properties: { email: "ben.okoro@example.com", firstname: "Ben", lastname: "Okoro", phone: "214-555-0102" } },
  { id: "c-103", properties: { email: "", firstname: "Dee", lastname: "Alvarez" } },
  { id: "c-104", properties: { email: "mara.lind@example.com", firstname: "Mara", lastname: "Lind", neighborhood: "Bishop Arts" } },
  { id: "c-105", properties: { email: "theo.grant@example.com", firstname: "Theo", lastname: "Grant" } },
];

export const avaTourLog = [
  "Saturday October 10th",
  "Maple Row Lofts: 11am (ask about the corner unit)",
  "The Ellsworth: 12:30pm",
  "Cedar & Pine - 2pm",
  "Trying to book Halden Park for Sunday at 4:30pm",
  "* Bring a photo ID and your last two pay stubs",
].join("\n");

export const deals: FakeDeal[] = [
  {
    id: "d-201", contactId: "c-101",
    properties: {
      dealname: "Ava Chen, 1 bed Uptown", dealstage: "list_sent_asap", createdate: "2026-10-01T15:00:00Z",
      top_picks: "Maple Row Lofts and The Ellsworth", report_link: "https://reports.example/ava",
      tour_log: avaTourLog, commission_rate: "50%", internal_notes: "Prefers texts after 6", hubspot_owner_id: "o-jay",
    },
  },
  { id: "d-202", contactId: "c-103", properties: { dealname: "Dee Alvarez, 2 bed", dealstage: "list_sent_60", createdate: "2026-10-03T15:00:00Z", hubspot_owner_id: "o-rosa" } },
  // Ben moved with Northline last year, and is back for a new place.
  { id: "d-203", contactId: "c-102", properties: { dealname: "Ben Okoro, 2025 move", dealstage: "closed_won", createdate: "2025-03-02T15:00:00Z", hubspot_owner_id: "o-rosa" } },
  { id: "d-204", contactId: "c-102", properties: { dealname: "Ben Okoro, 2026 move", dealstage: "list_sent_30", createdate: "2026-10-02T15:00:00Z", hubspot_owner_id: "o-jay" } },
  { id: "d-205", contactId: "c-104", properties: { dealname: "Mara Lind", dealstage: "moved_in", createdate: "2026-07-14T15:00:00Z", move_in_date: "2026-09-01", unit_number: "412", hubspot_owner_id: "o-rosa" } },
  { id: "d-206", contactId: "c-105", properties: { dealname: "Theo Grant", dealstage: "closed_lost", createdate: "2026-05-20T15:00:00Z" } },
];

/** Stand ins for signed Supabase JWTs. */
export const tokens: Record<string, Identity> = {
  "token-ava": { userId: "u-ava", email: "ava.chen@example.com" },
  "token-mara": { userId: "u-mara", email: "Mara.Lind@example.com" },
  "token-nobody": { userId: "u-x", email: "former.lead@example.com" },
};

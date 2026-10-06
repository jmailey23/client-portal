/**
 * Which dashboard a client sees, from where their deal sits in the pipeline.
 *
 * The broker already moves every deal through stages in the CRM. The portal
 * reads that stage and nothing else, so nobody maintains a second status by
 * hand and the dashboard can never disagree with the CRM.
 *
 *   searching  the search: properties report, tour schedule
 *   signing    applied, waiting on approval: the post application checklist
 *   lifestyle  moved in: neighborhood guide, partner perks, rebate, referrals
 *   dead       every deal lost: a stripped down referral only view
 */
import type { CrmRecord } from "./types.ts";

export type Phase = "searching" | "signing" | "lifestyle" | "dead";

/** Northline's pipeline, in order. A real pipeline's stage ids go here. */
export const STAGE_PHASE: Record<string, Phase> = {
  new_lead: "searching",
  contacted: "searching",
  waiting_on_list: "searching",
  list_sent_asap: "searching",
  list_sent_30: "searching",
  list_sent_60: "searching",
  future_move: "searching",
  touring: "searching",
  touring_follow_up: "searching",
  applied: "signing",
  lease_approved: "signing",
  moved_in: "lifestyle",
  invoice_sent: "lifestyle",
  paid: "lifestyle",
  closed_won: "lifestyle",
  closed_lost: "dead",
};

/**
 * An unknown stage shows the search. A broker can add a stage in the CRM
 * without telling anyone, and the safe failure is the view every client
 * starts in, not one that unlocks move in perks.
 */
export function phaseForStage(stage: string | null | undefined): Phase {
  return STAGE_PHASE[String(stage ?? "").toLowerCase()] ?? "searching";
}

/**
 * The deal the client is living in now: the newest one that is not lost.
 * A returning client gets a new deal for a new move while the old one stays
 * closed won, so "furthest along" would show last year's move in perks
 * against this year's search.
 */
export function currentDeal(deals: CrmRecord[]): CrmRecord | null {
  if (!deals.length) return null;
  const live = deals.filter((d) => phaseForStage(d.properties.dealstage) !== "dead");
  const pool = live.length ? live : deals;
  return [...pool].sort((a, b) => {
    const diff = created(b) - created(a);
    return diff !== 0 ? diff : b.id.localeCompare(a.id);
  })[0];
}

const created = (d: CrmRecord) => Date.parse(d.properties.createdate ?? "") || 0;

export function phaseFor(deals: CrmRecord[]): Phase {
  if (!deals.length) return "searching";
  if (deals.every((d) => phaseForStage(d.properties.dealstage) === "dead")) return "dead";
  return phaseForStage(currentDeal(deals)?.properties.dealstage);
}

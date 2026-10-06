/**
 * The CRM proxy: the one server function between a client's browser and the
 * brokerage's CRM.
 *
 *   1. Verify the caller's token. No token, no data.
 *   2. Find the caller's CRM contact by the email on the verified token,
 *      never by anything in the request body.
 *   3. Read their deals, pick the current one, work out the phase, and turn
 *      the broker's tour notes into cards.
 *   4. Return an allowlist of fields. The CRM record carries commission
 *      rates and internal notes; a new field added in the CRM tomorrow is
 *      withheld until someone adds it here on purpose.
 *
 * One action is public: verifyEmail, which signup uses. It answers yes or no
 * and nothing else.
 */
import { bearer, type TokenVerifier } from "./auth.ts";
import type { Crm } from "./crm.ts";
import { currentDeal, phaseFor, type Phase } from "./phase.ts";
import { parseTourLog } from "./tours.ts";
import type { CrmRecord, TourCards } from "./types.ts";

/** The only contact fields a client is shown. */
export const CLIENT_CONTACT_FIELDS = ["firstname", "lastname", "email", "neighborhood"] as const;

/** The only deal fields a client is shown. */
export const CLIENT_DEAL_FIELDS = [
  "dealname", "top_picks", "report_link", "move_in_date", "rent_amount", "unit_number",
] as const;

export interface PortalRequest {
  action: string;
  /** The Authorization header, "Bearer <token>". */
  authorization?: string;
  body?: Record<string, unknown>;
}

export interface PortalResponse {
  status: number;
  body: unknown;
}

export interface Dashboard {
  client: Record<string, string>;
  deal: Record<string, string> | null;
  phase: Phase;
  agent: string | null;
  tours: TourCards;
}

export function pick(record: CrmRecord | null, fields: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = record?.properties[f];
    if (v != null && v !== "") out[f] = v;
  }
  return out;
}

export function createPortal({ crm, verifier }: { crm: Crm; verifier: TokenVerifier }) {
  async function handle(req: PortalRequest): Promise<PortalResponse> {
    try {
      if (req.action === "verifyEmail") {
        const email = typeof req.body?.email === "string" ? req.body.email : "";
        if (!email) return { status: 400, body: { error: "email is required" } };
        return { status: 200, body: { exists: (await crm.findContactByEmail(email)) !== null } };
      }

      const identity = await verifier.verify(bearer(req.authorization));
      if (!identity) return { status: 401, body: { error: "sign in again" } };

      if (req.action !== "dashboard") return { status: 400, body: { error: `unknown action: ${req.action}` } };

      const contact = await crm.findContactByEmail(identity.email);
      if (!contact) return { status: 404, body: { error: "no client record for this account" } };

      const deals = await crm.dealsForContact(contact.id);
      const deal = currentDeal(deals);
      const ownerId = deal?.properties.hubspot_owner_id;
      const dashboard: Dashboard = {
        client: pick(contact, CLIENT_CONTACT_FIELDS),
        deal: deal ? pick(deal, CLIENT_DEAL_FIELDS) : null,
        phase: phaseFor(deals),
        agent: ownerId ? await crm.ownerName(ownerId) : null,
        // Only the current deal's tours: a returning client's search starts clean.
        tours: parseTourLog(deal?.properties.tour_log),
      };
      return { status: 200, body: dashboard };
    } catch (error) {
      // The CRM's error text can name fields and ids; log it, do not return it.
      console.error("portal:", error instanceof Error ? error.message : error);
      return { status: 502, body: { error: "the CRM is not answering, try again shortly" } };
    }
  }

  return { handle };
}

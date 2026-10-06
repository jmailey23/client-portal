/**
 * A CRM record as the CRM returns it: an id and a bag of string properties.
 * Contacts and deals both look like this. The bag holds everything the
 * brokerage tracks, including fields a client must never see (commission
 * rates, internal notes), which is why the portal returns an allowlist and
 * never the bag.
 */
export interface CrmRecord {
  id: string;
  properties: Record<string, string | null | undefined>;
}

/** Who a verified token belongs to. The email is the join key to the CRM. */
export interface Identity {
  userId: string;
  email: string;
}

/** One stop on a tour day. */
export interface TourStop {
  name: string;
  time: string;
  note: string | null;
}

export interface TourDay {
  date: string;
  tours: TourStop[];
}

export interface TourCards {
  days: TourDay[];
  /** Everything that is not a tour: reminders, plans, asides. Shown as notes, never dropped. */
  notes: string[];
}

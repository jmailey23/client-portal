/**
 * Signup is for clients only.
 *
 * The portal shows a client their own search, so an account only makes sense
 * for someone the brokerage is already working with. The test is the CRM: an
 * email that is not a contact there does not get an account. Clients are told
 * to sign up with the email their agent has on file, which is also what the
 * welcome email says.
 *
 * The check and the account creation happen together, on the server. An
 * account store that only this function can write to means there is no
 * second door that skips the check.
 */
import { normalizeEmail, type Crm } from "./crm.ts";

export interface Account {
  userId: string;
  email: string;
  firstName: string;
  crmContactId: string;
}

export interface AccountStore {
  findByEmail(email: string): Promise<Account | null>;
  create(a: Omit<Account, "userId">, password: string): Promise<Account>;
}

export class MemoryAccounts implements AccountStore {
  readonly accounts: Account[] = [];
  async findByEmail(email: string) {
    return this.accounts.find((a) => a.email === normalizeEmail(email)) ?? null;
  }
  async create(a: Omit<Account, "userId">, _password: string) {
    const account = { ...a, userId: `u-${this.accounts.length + 1}` };
    this.accounts.push(account);
    return account;
  }
}

export type SignupResult =
  | { ok: true; account: Account }
  | { ok: false; reason: "not_a_client" | "already_registered" | "invalid" };

export function createSignup({ crm, accounts }: { crm: Crm; accounts: AccountStore }) {
  return async function signUp(input: { email: string; password: string; firstName: string }): Promise<SignupResult> {
    const email = normalizeEmail(input.email);
    if (!email || !input.firstName.trim() || input.password.length < 8) return { ok: false, reason: "invalid" };

    const contact = await crm.findContactByEmail(email);
    if (!contact) return { ok: false, reason: "not_a_client" };
    if (await accounts.findByEmail(email)) return { ok: false, reason: "already_registered" };

    const account = await accounts.create(
      { email, firstName: input.firstName.trim(), crmContactId: contact.id },
      input.password,
    );
    return { ok: true, account };
  };
}

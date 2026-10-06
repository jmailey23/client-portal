/**
 * Who is asking.
 *
 * The portal only trusts an identity that came from verifying the caller's
 * token on the server. It never trusts an email, contact id or deal id in the
 * request body: those are the caller's claims, and a logged in client could
 * put anyone's email there.
 *
 * StubVerifier maps fixed tokens to people, for the tests and the demo.
 * SupabaseVerifier asks Supabase Auth, which is what production does.
 */
import type { Identity } from "./types.ts";

export interface TokenVerifier {
  /** The identity behind a bearer token, or null if the token is missing, forged or expired. */
  verify(token: string): Promise<Identity | null>;
}

export class StubVerifier implements TokenVerifier {
  constructor(private tokens: Record<string, Identity>) {}
  async verify(token: string) {
    return this.tokens[token] ?? null;
  }
}

export class SupabaseVerifier implements TokenVerifier {
  constructor(
    private url = process.env.SUPABASE_URL ?? "",
    private anonKey = process.env.SUPABASE_ANON_KEY ?? "",
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async verify(token: string): Promise<Identity | null> {
    if (!token || !this.url) return null;
    // The same check as supabase.auth.getUser(): Supabase validates the JWT
    // and returns the user, or a 401 for a bad or expired token.
    const res = await this.fetchImpl(`${this.url}/auth/v1/user`, {
      headers: { apikey: this.anonKey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string; email?: string };
    return user.id && user.email ? { userId: user.id, email: user.email } : null;
  }
}

export function bearer(header: string | undefined): string {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return m ? m[1].trim() : "";
}

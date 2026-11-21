/**
 * Normalise hosted-Postgres URLs (Neon, Vercel Postgres, Supabase):
 * pg treats sslmode=require as verify-full and doesn't understand channel_binding, so we strip those
 * query params and pass an explicit, certificate-verifying TLS config instead.
 */
export function pgConfig(url: string) {
  const u = new URL(url);
  const mode = u.searchParams.get("sslmode");
  u.searchParams.delete("sslmode");
  u.searchParams.delete("channel_binding");
  u.searchParams.delete("ssl");
  const local = ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
  const useSsl = mode ? mode !== "disable" : !local;
  return { connectionString: u.toString(), ssl: useSsl ? { rejectUnauthorized: true } : undefined };
}

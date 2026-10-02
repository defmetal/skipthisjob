import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let adminClient: SupabaseClient | null = null;
let anonClient: SupabaseClient | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[SkipThisJob] Missing ${name}`);
    throw new Error(`Supabase is not configured (${name})`);
  }
  return value;
}

/** Server client. Created on first use so `next build` can import routes without env. */
export function getSupabaseAdmin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    );
  }
  return adminClient;
}

/** Browser-style client. Not used by API routes; same lazy init. */
export function getSupabaseAnon(): SupabaseClient {
  if (!anonClient) {
    anonClient = createClient(
      requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
      requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    );
  }
  return anonClient;
}

function lazyClient(resolve: () => SupabaseClient): SupabaseClient {
  return new Proxy({} as SupabaseClient, {
    get(_target, prop) {
      const client = resolve();
      const value = Reflect.get(client, prop, client);
      return typeof value === 'function' ? value.bind(client) : value;
    },
  });
}

// Kept so existing imports do not construct a client at module load.
export const supabase = lazyClient(getSupabaseAnon);
export const supabaseAdmin = lazyClient(getSupabaseAdmin);

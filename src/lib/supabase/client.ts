import { createBrowserClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/**
 * Supabase's email invitation verification returns an implicit session in the
 * browser URL fragment. Keep this client separate so the normal application
 * client remains on the SSR-friendly PKCE flow.
 */
export function createInvitationClient() {
  // @supabase/ssr's browser client intentionally forces PKCE. Invitations
  // verified by Supabase Auth return an implicit session in the URL fragment,
  // so this narrowly scoped client must use supabase-js directly. The normal
  // application client above remains unchanged.
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: "implicit",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    },
  );
}

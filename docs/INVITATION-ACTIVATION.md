# Invitation and account activation

Store Owner and staff invitations use Supabase Auth's server-side
`inviteUserByEmail` flow. The application does not create, transmit, or store a
temporary password.

## Flow

1. A server action authorized for the inviter calls `inviteUserByEmail` with a
   redirect to `/accept-invite`.
2. Supabase establishes the invited user's Auth session through the invitation
   link.
3. `/accept-invite` accepts the supported Supabase callback forms (session
   hash, authorization code, or invitation token hash).
4. The user sets and confirms a password with `supabase.auth.updateUser`.
5. The page verifies the existing profile by the authenticated Auth user ID,
   tenant, active status, email, and existing role. It never accepts tenant or
   role input from the browser.
6. Store Owners go to `/store/dashboard`; invited operational staff go to
   `/portal`.

## Redirect configuration

Set `NEXT_PUBLIC_SITE_URL` to the public application origin in each deployment,
for example `https://pos.example.com`. Add the exact URL below to Supabase
Authentication URL Configuration / Redirect URLs:

`https://pos.example.com/accept-invite`

For local development, allow-list the matching local URL, such as
`http://localhost:3000/accept-invite`. The server also derives the request host
when `NEXT_PUBLIC_SITE_URL` is not set, but that host must still be present in
Supabase's allow-list.

The Supabase service-role key is used only by server actions. Passwords are
managed by Supabase Auth and are never written to application tables.

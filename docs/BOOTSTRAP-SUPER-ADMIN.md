# Super Admin Bootstrap

The initial Super Admin is provisioned by a one-time server-side command. There is no public bootstrap route and the service-role key is never sent to the browser.

Before running it, set these values in a server-only environment such as `.env.local`:

- `SUPER_ADMIN_BOOTSTRAP_TOKEN`: a high-entropy one-time secret used to authorize the command.
- `BOOTSTRAP_SUPER_ADMIN_EMAIL`: the intended Auth account email.
- `BOOTSTRAP_SUPER_ADMIN_PASSWORD`: a strong temporary password for that account.
- `BOOTSTRAP_SUPER_ADMIN_NAME`: the profile display name.

The existing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are also required. None of the bootstrap variables may use the `NEXT_PUBLIC_` prefix.

Run from the project root:

```bash
npm run bootstrap:super-admin
```

The command refuses to run when:

- The bootstrap token is missing.
- Any `SUPER_ADMIN` profile already exists.
- The intended email belongs to an existing non-Super-Admin profile.
- Auth sign-in verification fails.

On success, remove the bootstrap variables from the runtime environment and rotate the bootstrap token. The Auth user remains managed by Supabase Auth, and the profile is created with `tenant_id = NULL` and role `SUPER_ADMIN`.

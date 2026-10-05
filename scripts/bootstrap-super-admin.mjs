import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

loadLocalEnv();

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPER_ADMIN_BOOTSTRAP_TOKEN",
  "BOOTSTRAP_SUPER_ADMIN_EMAIL",
  "BOOTSTRAP_SUPER_ADMIN_PASSWORD",
  "BOOTSTRAP_SUPER_ADMIN_NAME",
];

for (const name of required) {
  if (!process.env[name]) fail(`${name} is required.`);
}

const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL.trim().toLowerCase();
const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;
const name = process.env.BOOTSTRAP_SUPER_ADMIN_NAME.trim();
if (!email.includes("@") || password.length < 12 || name.length < 1) {
  fail("Bootstrap email, password, or name does not meet the minimum requirements.");
}

// The token is intentionally checked only for presence. Its value remains in
// the server process and is never logged or sent to the browser.
if (process.env.SUPER_ADMIN_BOOTSTRAP_TOKEN.length < 32) {
  fail("SUPER_ADMIN_BOOTSTRAP_TOKEN must be at least 32 characters.");
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const existingAdmin = await admin.from("profiles").select("id").eq("role", "SUPER_ADMIN").limit(1);
if (existingAdmin.error) fail(existingAdmin.error.message);
if (existingAdmin.data?.length) fail("A SUPER_ADMIN profile already exists. Bootstrap is one-time and will not create another.");

const existingAuth = await findAuthUser(email);
if (existingAuth) {
  const existingProfile = await admin.from("profiles").select("id, role").eq("id", existingAuth.id).maybeSingle();
  if (existingProfile.error) fail(existingProfile.error.message);
  if (existingProfile.data) {
    fail("The intended Auth user already has a profile. Refusing to change an existing user role.");
  }
}

let user = existingAuth;
let createdAuthUser = false;
if (!user) {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (created.error || !created.data.user) fail(created.error?.message ?? "Auth user creation failed.");
  user = created.data.user;
  createdAuthUser = true;
}

try {
  const inserted = await admin.from("profiles").insert({ id: user.id, tenant_id: null, role: "SUPER_ADMIN", full_name: name, email });
  if (inserted.error) throw new Error(inserted.error.message);

  const verified = await anon.auth.signInWithPassword({ email, password });
  if (verified.error || !verified.data.user) throw new Error("Super Admin Auth sign-in verification failed.");

  console.log("Super Admin bootstrap completed. Verify the account through the normal login screen, then remove the bootstrap variables.");
} catch (error) {
  await admin.from("profiles").delete().eq("id", user.id);
  if (createdAuthUser) await admin.auth.admin.deleteUser(user.id);
  fail(error instanceof Error ? error.message : "Super Admin bootstrap failed.");
}

async function findAuthUser(targetEmail) {
  for (let page = 1; page <= 10; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (result.error) fail(result.error.message);
    const found = result.data.users.find((candidate) => candidate.email?.toLowerCase() === targetEmail);
    if (found) return found;
    if (result.data.users.length < 100) return null;
  }
  fail("Auth user search exceeded the safe bootstrap page limit.");
}

function loadLocalEnv() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function fail(message) {
  console.error(`Bootstrap stopped: ${message}`);
  process.exit(1);
}

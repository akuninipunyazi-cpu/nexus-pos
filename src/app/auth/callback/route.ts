import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getApplicationUrl } from "@/lib/site-url";

export async function GET(request: NextRequest) {
  const destination = new URL("/register", await getApplicationUrl());
  const code = request.nextUrl.searchParams.get("code");
  if (!code || code.length > 4096) {
    destination.searchParams.set("state", "confirmation_failed");
    return NextResponse.redirect(destination);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    destination.searchParams.set("state", "confirmation_failed");
    return NextResponse.redirect(destination);
  }

  return NextResponse.redirect(new URL("/register/complete", await getApplicationUrl()));
}

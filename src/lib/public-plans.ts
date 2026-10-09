import "server-only";

import { createClient } from "@/lib/supabase/server";

export type PublicSubscriptionPlan = {
  id: string;
  name: string;
  code: string;
  price: number;
  currency: string;
  duration_days: number;
  max_staff: number | null;
  max_products: number | null;
  max_tables: number | null;
  can_checkout: boolean;
};

export async function getPublicSubscriptionPlans(): Promise<PublicSubscriptionPlan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_public_subscription_plans");
  if (error) throw new Error("Subscription plans are temporarily unavailable.");
  return (data ?? []).map((plan: PublicSubscriptionPlan) => ({
    ...plan,
    price: Number(plan.price),
    duration_days: Number(plan.duration_days),
  }));
}

export async function getPublicSubscriptionPlan(code: string): Promise<PublicSubscriptionPlan | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) return null;
  return (await getPublicSubscriptionPlans()).find((plan) => plan.code === code) ?? null;
}

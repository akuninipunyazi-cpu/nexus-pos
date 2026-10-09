import Link from "next/link";
import { getPublicSubscriptionPlans, type PublicSubscriptionPlan } from "@/lib/public-plans";
import { getMidtransBrowserConfig } from "@/lib/midtrans";
import { LandingPage } from "@/components/public/landing-page";

export const metadata = {
  title: "POS-CAFE | Operasional Coffee Shop dalam Satu Sistem",
  description: "Hubungkan order QR, kasir, kitchen, inventory, dan laporan owner dengan POS-CAFE.",
};

export default async function HomePage() {
  let plans: PublicSubscriptionPlan[] = [];
  let plansAvailable = true;
  let checkoutConfigured = false;

  try {
    plans = await getPublicSubscriptionPlans();
  } catch {
    plansAvailable = false;
  }
  try {
    getMidtransBrowserConfig();
    checkoutConfigured = true;
  } catch {
    checkoutConfigured = false;
  }

  return <>
    <LandingPage plans={plans} plansAvailable={plansAvailable} checkoutConfigured={checkoutConfigured} />
    <noscript><p><Link href="/login">Masuk ke POS-CAFE</Link></p></noscript>
  </>;
}

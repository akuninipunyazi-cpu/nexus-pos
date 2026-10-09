import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "POS-CAFE",
  description: "Sistem operasional untuk coffee shop.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}

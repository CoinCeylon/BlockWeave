import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { PartyProvider } from "@/lib/useParty";
import { ClientOnly } from "@/components/ClientOnly";

export const metadata: Metadata = {
  title: "TeaTrail · Ceylon tea, verified",
  description: "Tamper-proof lot passports on Cardano and sealed-bid auctions on Midnight.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <ClientOnly>
        <PartyProvider>
          <Nav />
          <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">{children}</main>
          <footer className="border-t border-line py-5 text-center text-xs text-muted">
            TeaTrail by BlockWeave · UniHack 2026 · Cardano Preprod + Midnight Preprod
          </footer>
        </PartyProvider>
        </ClientOnly>
      </body>
    </html>
  );
}

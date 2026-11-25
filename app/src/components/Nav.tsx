"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PARTIES } from "@/lib/data/mock";
import { useParty } from "@/lib/useParty";

const LINKS = [
  { href: "/", label: "Lots" },
  { href: "/estate", label: "Estate" },
  { href: "/checkpoint", label: "Checkpoint" },
  { href: "/auction", label: "Auction" },
];

export function Nav() {
  const path = usePathname();
  const { party, setPartyId } = useParty();
  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-5 py-3">
        <Link href="/" className="font-serif text-xl font-semibold text-leaf">
          TeaTrail
        </Link>
        <nav className="flex gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-md px-3 py-1.5 text-sm ${
                path === l.href ? "bg-leaf-soft font-medium text-leaf" : "text-muted hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          Acting as
          <select
            className="input w-auto py-1.5"
            value={party.id}
            onChange={(e) => setPartyId(e.target.value)}
            title="Mock wallet. Becomes the connected Lace account on chain."
          >
            {PARTIES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.role})
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}

"use client";

// Mock "wallet": pick which party you're acting as. On chain this becomes
// the connected Lace account; the role comes from the registry.

import { createContext, useContext, useState } from "react";
import { PARTIES } from "./data/mock";
import type { Party } from "./types";

const Ctx = createContext<{ party: Party; setPartyId: (id: string) => void }>({
  party: PARTIES[0],
  setPartyId: () => {},
});

export function PartyProvider({ children }: { children: React.ReactNode }) {
  const [id, setId] = useState(() => {
    try {
      const saved = localStorage.getItem("teatrail-party");
      if (saved && PARTIES.some((p) => p.id === saved)) return saved;
    } catch {}
    return PARTIES[0].id;
  });
  const setPartyId = (v: string) => {
    setId(v);
    try {
      localStorage.setItem("teatrail-party", v);
    } catch {}
  };
  const party = PARTIES.find((p) => p.id === id) ?? PARTIES[0];
  return <Ctx.Provider value={{ party, setPartyId }}>{children}</Ctx.Provider>;
}

export const useParty = () => useContext(Ctx);

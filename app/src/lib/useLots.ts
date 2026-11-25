"use client";

import { useCallback, useEffect, useState } from "react";
import { getSource } from "./data";
import type { LotWithHistory } from "./types";

export function useLots() {
  const [lots, setLots] = useState<LotWithHistory[] | null>(null);
  const reload = useCallback(() => {
    getSource().listLots().then((l) => setLots([...l]));
  }, []);
  useEffect(reload, [reload]);
  return { lots, reload };
}

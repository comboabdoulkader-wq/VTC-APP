import { useEffect, useRef, useState } from "react";

import { apiFetch } from "@/src/context/auth";
import { Place } from "@/src/data/places";

/** Debounced worldwide address autocomplete (Photon/OSM via backend), biased around a location. */
export function useAddressSearch(query: string, near?: { lat: number; lng: number } | null) {
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) { setResults([]); setSearching(false); return; }
    const id = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const bias = near ? `&lat=${near.lat}&lng=${near.lng}` : "";
        const list = await apiFetch<any[]>(`/geo/search?q=${encodeURIComponent(q)}${bias}`);
        if (id === seq.current) setResults(list.map((p) => ({ id: p.id, name: p.name, address: p.address, lat: p.lat, lng: p.lng })));
      } catch {
        if (id === seq.current) setResults([]);
      } finally {
        if (id === seq.current) setSearching(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [query, near?.lat, near?.lng]);

  return { results, searching };
}

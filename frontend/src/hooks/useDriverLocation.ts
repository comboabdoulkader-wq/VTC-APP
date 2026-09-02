import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Platform } from "react-native";
import * as Location from "expo-location";

import { apiFetch } from "@/src/context/auth";

export type LocPermission = "unknown" | "granted" | "denied" | "blocked";
export type Coords = { lat: number; lng: number };

/**
 * Live GPS for drivers. Follows the permission contract:
 * check -> contextual explanation -> request (max 1 retry) -> "Open settings" when blocked.
 * While `active`, streams the position to the backend every ~5s / 25m.
 */
export function useDriverLocation(token: string | null, active: boolean, onPing?: (res: { eta_min?: number; arrival_alert?: boolean }) => void) {
  const [permission, setPermission] = useState<LocPermission>("unknown");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [askedOnce, setAskedOnce] = useState(false);
  const sub = useRef<Location.LocationSubscription | null>(null);

  const check = useCallback(async () => {
    const p = await Location.getForegroundPermissionsAsync();
    if (p.granted) setPermission("granted");
    else if (p.status === "denied" && !p.canAskAgain) setPermission("blocked");
    else if (p.status === "denied") setPermission("denied");
    else setPermission("unknown");
    return p;
  }, []);

  useEffect(() => { check(); }, [check]);

  const request = useCallback(async () => {
    const p = await Location.requestForegroundPermissionsAsync();
    setAskedOnce(true);
    if (p.granted) { setPermission("granted"); return true; }
    setPermission(p.canAskAgain ? "denied" : "blocked");
    return false;
  }, []);

  const openSettings = useCallback(() => { Linking.openSettings(); }, []);

  const push = useCallback(async (c: Coords) => {
    setCoords(c);
    if (!token) return;
    try {
      const res = await apiFetch<{ eta_min?: number; arrival_alert?: boolean }>("/driver/location", { method: "POST", body: JSON.stringify(c) }, token);
      onPing?.(res);
    } catch {}
  }, [token, onPing]);

  useEffect(() => {
    if (!active || permission !== "granted") {
      sub.current?.remove(); sub.current = null;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!cancelled) push({ lat: first.coords.latitude, lng: first.coords.longitude });
        sub.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 25 },
          (pos) => push({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        );
      } catch {}
    })();
    return () => { cancelled = true; sub.current?.remove(); sub.current = null; };
  }, [active, permission, push]);

  return { permission, coords, request, openSettings, askedOnce, canRetry: permission === "denied" && !askedOnce, isWeb: Platform.OS === "web" };
}

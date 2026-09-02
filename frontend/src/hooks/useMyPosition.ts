import { useCallback, useEffect, useState } from "react";
import { Linking } from "react-native";
import * as Location from "expo-location";

import { apiFetch } from "@/src/context/auth";
import { Place } from "@/src/data/places";

export type GpsStatus = "idle" | "locating" | "granted" | "denied" | "blocked" | "error";

/** Passenger GPS: resolves the current position to a Place (reverse geocoded). Permission contract compliant. */
export function useMyPosition() {
  const [status, setStatus] = useState<GpsStatus>("idle");
  const [place, setPlace] = useState<Place | null>(null);
  const [asked, setAsked] = useState(false);

  const locate = useCallback(async () => {
    setStatus("locating");
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lng } = pos.coords;
      let p: Place = { id: "gps", name: "Ma position", address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng };
      try {
        const rev = await apiFetch<any>(`/geo/reverse?lat=${lat}&lng=${lng}`);
        p = { id: "gps", name: "Ma position", address: rev.address || p.address, lat, lng };
      } catch {}
      setPlace(p);
      setStatus("granted");
    } catch {
      setStatus("error");
    }
  }, []);

  // Silent check on mount: only locate if already granted (never prompt without user intent)
  useEffect(() => {
    (async () => {
      try {
        const p = await Location.getForegroundPermissionsAsync();
        if (p.granted) locate();
        else if (p.status === "denied" && !p.canAskAgain) setStatus("blocked");
      } catch {}
    })();
  }, [locate]);

  const request = useCallback(async () => {
    setAsked(true);
    try {
      const p = await Location.requestForegroundPermissionsAsync();
      if (p.granted) { await locate(); return true; }
      setStatus(p.canAskAgain ? "denied" : "blocked");
    } catch { setStatus("error"); }
    return false;
  }, [locate]);

  return { status, place, request, refresh: locate, asked, openSettings: () => Linking.openSettings() };
}

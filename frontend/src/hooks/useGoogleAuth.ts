import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { apiFetch, useAuth, User } from "@/src/context/auth";

WebBrowser.maybeCompleteAuthSession();

const AUTH_URL = "https://auth.emergentagent.com/";
const ROLE_KEY = "ridego_google_role";
const sent = new Set<string>(); // guard: never exchange the same session_id twice

export const extractSessionId = (url?: string | null) => url?.match(/[?#&]session_id=([^&#]+)/)?.[1] || null;

/** Google sign-in (Emergent managed). Exchanges the one-time session_id for our own JWT via POST /api/auth/session. */
export function useGoogleAuth() {
  const { setSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const roleRef = useRef<"passenger" | "driver">("passenger");

  const exchange = useCallback(async (sessionId: string, role?: string) => {
    if (sent.has(sessionId)) return false;
    sent.add(sessionId);
    setBusy(true); setError(null);
    try {
      const r = await apiFetch<{ access_token: string; user: User }>("/auth/session", { method: "POST", body: JSON.stringify({ session_id: sessionId, role: role || roleRef.current }) });
      await setSession(r.access_token, r.user);
      return true;
    } catch (e: any) { setError(e.message || "Connexion Google impossible"); return false; } finally { setBusy(false); }
  }, [setSession]);

  const signIn = useCallback(async (role: "passenger" | "driver" = "passenger") => {
    roleRef.current = role;
    setError(null);
    if (Platform.OS === "web") {
      localStorage.setItem(ROLE_KEY, role);
      const redirect = window.location.origin + "/";
      window.location.href = `${AUTH_URL}?redirect=${encodeURIComponent(redirect)}`;
      return;
    }
    const redirect = Linking.createURL("");
    let captured: string | null = null;
    const sub = Linking.addEventListener("url", ({ url }) => { captured = captured || extractSessionId(url); });
    try {
      setBusy(true);
      const result = await WebBrowser.openAuthSessionAsync(`${AUTH_URL}?redirect=${encodeURIComponent(redirect)}`, redirect);
      const fromResult = result.type === "success" ? extractSessionId(result.url) : null;
      const sid = fromResult || captured || extractSessionId(await Linking.getInitialURL());
      if (sid) await exchange(sid, role);
      else if (result.type !== "success") setBusy(false);
    } finally { sub.remove(); setBusy(false); }
  }, [exchange]);

  return { signIn, exchange, busy, error };
}

/** Mount once at the app root: completes a Google sign-in when the app is (re)opened with a session_id (web redirect or native cold start). */
export function useGoogleCallback() {
  const { exchange } = useGoogleAuth();
  useEffect(() => {
    if (Platform.OS === "web") {
      const sid = extractSessionId(window.location.hash) || extractSessionId(window.location.search);
      if (!sid) return;
      const role = (localStorage.getItem(ROLE_KEY) as any) || "passenger";
      exchange(sid, role).then((ok) => {
        if (!ok) return;
        localStorage.removeItem(ROLE_KEY);
        const url = new URL(window.location.href);
        url.hash = url.hash.replace(/([#&]?)session_id=[^&]*&?/, "$1").replace(/^#&/, "#").replace(/^#$/, "");
        url.searchParams.delete("session_id");
        window.history.replaceState(window.history.state, "", url.toString());
      });
      return;
    }
    Linking.getInitialURL().then((u) => { const sid = extractSessionId(u); if (sid) exchange(sid); });
    const sub = Linking.addEventListener("url", ({ url }) => { const sid = extractSessionId(url); if (sid) exchange(sid); });
    return () => sub.remove();
  }, [exchange]);
}

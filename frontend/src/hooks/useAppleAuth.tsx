import { useCallback, useState } from "react";
import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";

import { apiFetch, useAuth, User } from "@/src/context/auth";

/**
 * Sign in with Apple (native iOS only). Gets an Apple identity token, exchanges it
 * for our own JWT via POST /api/auth/apple, then sets the session. Name/email are
 * only returned by Apple on the very first authorization, so we forward them then.
 */
export function useAppleAuth() {
  const { setSession } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async (role: "passenger" | "driver" = "passenger"): Promise<User | null> => {
    if (Platform.OS !== "ios") return null;
    setError(null);
    setBusy(true);
    try {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!cred.identityToken) throw new Error("Jeton Apple manquant");
      const fullName = cred.fullName
        ? [cred.fullName.givenName, cred.fullName.familyName].filter(Boolean).join(" ").trim()
        : "";
      const r = await apiFetch<{ access_token: string; user: User }>("/auth/apple", {
        method: "POST",
        body: JSON.stringify({
          identity_token: cred.identityToken,
          role,
          full_name: fullName || undefined,
          email: cred.email || undefined,
        }),
      });
      await setSession(r.access_token, r.user);
      return r.user;
    } catch (e: any) {
      if (e?.code !== "ERR_REQUEST_CANCELED") setError(e?.message || "Connexion Apple impossible");
      return null;
    } finally {
      setBusy(false);
    }
  }, [setSession]);

  return { signIn, busy, error };
}

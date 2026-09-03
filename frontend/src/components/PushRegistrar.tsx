import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

import { apiFetch, useAuth } from "@/src/context/auth";

/**
 * Registers the device push token (native FCM/APNs) with the backend relay.
 * Runs after login and every time the app comes back to the foreground (tokens rotate).
 * No-op on web, on simulators and in Expo Go (push needs a native build).
 */
export default function PushRegistrar() {
  const { user, token } = useAuth();
  const lastSent = useRef<string | null>(null);

  const register = useCallback(async () => {
    if (Platform.OS === "web" || !user || !token || !Device.isDevice) return;
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return; // Expo Go: unsupported
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== "granted") return;
      const { data: deviceToken } = await Notifications.getDevicePushTokenAsync();
      const key = `${user.id}:${deviceToken}`;
      if (lastSent.current === key) return;
      await apiFetch("/register-push", { method: "POST", body: JSON.stringify({ user_id: user.id, platform: Platform.OS, device_token: deviceToken }) }, token);
      lastSent.current = key;
    } catch (e) {
      console.log("push registration skipped:", (e as Error).message);
    }
  }, [user, token]);

  useEffect(() => {
    register();
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") register(); });
    return () => sub.remove();
  }, [register]);

  return null;
}

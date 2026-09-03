import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";

type NotificationsModule = typeof import("expo-notifications");

/**
 * Lazily loads expo-notifications ONLY where remote push is supported (native dev/production builds).
 * Merely evaluating the module crashes on Android Expo Go (SDK 53+) and is unsupported on web,
 * so the import must never be static. Returns null in Expo Go and on web.
 */
export function pushSupported(): boolean {
  return Platform.OS !== "web" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

let cached: NotificationsModule | null | undefined;
export function getNotifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  if (!pushSupported()) { cached = null; return null; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("expo-notifications") as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}

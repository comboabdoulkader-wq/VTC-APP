import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect } from "react";
import { Alert, LogBox, Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/context/auth";
import PushRegistrar from "@/src/components/PushRegistrar";
import { I18nProvider } from "@/src/i18n";
import { theme } from "@/src/theme";
import { getNotifications } from "@/src/utils/push";
import { FRAME_WIDTH, useResponsive } from "@/src/hooks/useResponsive";

// Disable logbox errors so users see the app.
LogBox.ignoreAllLogs(true);

// Keep native splash visible until icon fonts register.
// Required so icon glyphs are available on first render (Expo Go loads the font from a CDN).
SplashScreen.preventAutoHideAsync();

// ---- Push notifications (native builds only; expo-notifications is never evaluated in Expo Go / web) ----
const Notifications = getNotifications();
if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === "android") {
    Notifications.setNotificationChannelAsync("default", {
      name: "Courses et alertes",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}


export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  // Tablets (≥ 600 px) and desktop: centred column so line lengths and reach stay phone-like.
  const { framed } = useResponsive();
  const router = useRouter();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  useEffect(() => {
    if (!Notifications) return;
    const open = (data: Record<string, any>) => {
      const url = data?.deeplink || data?.action_url;
      if (!url || typeof url !== "string") return;
      if (url.startsWith("http")) Linking.openURL(url);
      else router.push(url as any);
    };
    // Warm tap (app open / background)
    const tapSub = Notifications.addNotificationResponseReceivedListener((response) => open(response.notification.request.content.data || {}));
    // Cold start tap (app was killed)
    Notifications.getLastNotificationResponseAsync().then((response) => { if (response) open(response.notification.request.content.data || {}); });
    // Weekly nudge for users who permanently denied notifications
    (async () => {
      try {
        const { status, canAskAgain } = await Notifications.getPermissionsAsync();
        if (status !== "denied" || canAskAgain) return;
        const lastNudge = await AsyncStorage.getItem("pushNudgeAt");
        if (lastNudge && Date.now() - Number(lastNudge) <= 7 * 24 * 60 * 60 * 1000) return;
        const stamp = () => AsyncStorage.setItem("pushNudgeAt", String(Date.now()));
        Alert.alert(
          "Activer les notifications",
          "Recevez les nouvelles courses et les alertes chauffeur même quand l'application est fermée.",
          [
            { text: "Plus tard", style: "cancel", onPress: () => { stamp(); } },
            { text: "Ouvrir les réglages", onPress: () => { stamp(); Linking.openSettings(); } },
          ],
        );
      } catch { /* ignore */ }
    })();
    return () => { tapSub.remove(); };
  }, [router]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={[styles.root, framed && styles.rootFramed]}>
      <SafeAreaProvider>
        <I18nProvider>
          <AuthProvider>
            <PushRegistrar />
            <View style={[styles.frame, framed && styles.frameWide]}>
              <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
            </View>
          </AuthProvider>
        </I18nProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootFramed: { backgroundColor: "#ECECEC" },
  frame: { flex: 1, width: "100%" },
  frameWide: {
    maxWidth: FRAME_WIDTH, alignSelf: "center", backgroundColor: theme.color.surface, overflow: "hidden",
    ...Platform.select({ web: { boxShadow: "0 0 40px rgba(0,0,0,0.12)" } as any, default: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: theme.color.border } }),
  },
});

import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/context/auth";
import { theme } from "@/src/theme";

// Disable logbox errors so users see the app.
LogBox.ignoreAllLogs(true);

// Keep native splash visible until icon fonts register.
// Required so icon glyphs are available on first render (Expo Go loads the font from a CDN).
SplashScreen.preventAutoHideAsync();

/** On wide screens (web desktop / large tablets) the app is centred in a phone-width column instead of stretching edge to edge. */
const WIDE_BREAKPOINT = 820;
const FRAME_WIDTH = 480;

export default function RootLayout() {
  const [loaded, error] = useIconFonts();
  const { width } = useWindowDimensions();
  const framed = width >= WIDE_BREAKPOINT;

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={[styles.root, framed && styles.rootFramed]}>
      <SafeAreaProvider>
        <AuthProvider>
          <View style={[styles.frame, framed && styles.frameWide]}>
            <Stack screenOptions={{ headerShown: false, animation: "fade" }} />
          </View>
        </AuthProvider>
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

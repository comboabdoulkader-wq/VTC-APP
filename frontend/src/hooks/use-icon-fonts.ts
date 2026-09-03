// Icon font loader for Expo Go. The scoped @react-native-vector-icons packages
// load their .ttf dynamically through expo-font, but under Expo Go (StoreClient)
// the Metro asset resolver can return 0-byte fonts on Android. As a fallback we
// register the font from a CDN there. Native dev/prod builds (config plugin
// embeds the font) and web pass an empty map, so useFonts resolves immediately.
// ICON_PKG_VERSION must match @react-native-vector-icons/material-design-icons in package.json.
// Usage: const [loaded, error] = useIconFonts();

import Constants, { ExecutionEnvironment } from "expo-constants";
import { useFonts } from "expo-font";

const ICON_PKG_VERSION = "13.1.3";

const iconFontMap = (): Record<string, string> => ({
  MaterialDesignIcons: `https://cdn.jsdelivr.net/npm/@react-native-vector-icons/material-design-icons@${ICON_PKG_VERSION}/fonts/MaterialDesignIcons.ttf`,
});

export const useIconFonts = (): readonly [boolean, Error | null] =>
  useFonts(Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? iconFontMap() : {});

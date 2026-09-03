import { View, Text, StyleSheet, Pressable, ImageBackground } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { theme } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function Welcome() {
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root} testID="welcome-screen">
      <ImageBackground
        source={{ uri: "https://images.unsplash.com/photo-1550242499-b5171f56de56?crop=entropy&cs=srgb&fm=jpg&q=85" }}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
      />
      <LinearGradient
        colors={["transparent", "rgba(20,20,20,0.6)", "rgba(20,20,20,0.98)"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.content, { paddingTop: insets.top + theme.spacing.xl, paddingBottom: insets.bottom + theme.spacing.xl }]}>
        <View>
          <Text style={styles.brand} testID="brand-title">RideGo</Text>
        </View>
        <View>
          <Text style={styles.headline} maxFontSizeMultiplier={1.2} adjustsFontSizeToFit numberOfLines={3}>{t("welcome_title")}</Text>
          <Text style={styles.subtitle}>{t("welcome_subtitle")}</Text>

          <Pressable
            testID="cta-login"
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.push("/(auth)/login")}
          >
            <Text style={styles.primaryText}>{t("login")}</Text>
          </Pressable>

          <Pressable
            testID="cta-register"
            style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.85 }]}
            onPress={() => router.push("/(auth)/register")}
          >
            <Text style={styles.secondaryText}>{t("register")}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  content: { flex: 1, justifyContent: "space-between", paddingHorizontal: theme.spacing.xl },
  brand: { color: "#fff", fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  headline: { color: "#fff", fontSize: 40, fontWeight: "800", lineHeight: 46, letterSpacing: -1 },
  subtitle: { color: "rgba(255,255,255,0.75)", fontSize: 16, marginTop: theme.spacing.md, marginBottom: theme.spacing.xl },
  primaryBtn: { backgroundColor: "#fff", height: 56, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.md },
  primaryText: { color: "#141414", fontSize: 16, fontWeight: "700" },
  secondaryBtn: { backgroundColor: "rgba(255,255,255,0.15)", height: 56, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  secondaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});

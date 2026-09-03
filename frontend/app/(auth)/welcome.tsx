import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ImageBackground, ScrollView, ActivityIndicator } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { theme } from "@/src/theme";
import { useI18n, LANGS, Lang } from "@/src/i18n";

const LANG_FLAG = "lang_onboarded";

export default function Welcome() {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [gate, setGate] = useState<boolean | null>(null);

  useEffect(() => { AsyncStorage.getItem(LANG_FLAG).then((v) => setGate(!v)).catch(() => setGate(false)); }, []);
  const confirmLang = async () => { await AsyncStorage.setItem(LANG_FLAG, "1"); setGate(false); };

  if (gate === null) return <View style={[styles.root, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color="#fff" /></View>;

  if (gate) {
    return (
      <View style={[styles.root, { backgroundColor: theme.color.surface }]} testID="language-gate">
        <View style={{ flex: 1, paddingTop: insets.top + theme.spacing.xxl, paddingBottom: insets.bottom + theme.spacing.xl, paddingHorizontal: theme.spacing.xl, justifyContent: "space-between" }}>
          <View>
            <Text style={styles.brand}>RideGo</Text>
            <Text style={styles.gateTitle}>Choisissez votre langue</Text>
            <Text style={styles.gateSub}>Choose your language · Elige tu idioma · اختر لغتك · 选择语言</Text>
            <ScrollView style={{ marginTop: theme.spacing.xl }} contentContainerStyle={{ gap: theme.spacing.sm }}>
              {LANGS.map((l) => {
                const active = l.code === lang;
                return (
                  <Pressable key={l.code} testID={`gate-lang-${l.code}`} onPress={() => setLang(l.code as Lang)} style={[styles.langRow, active && styles.langRowActive]}>
                    <Text style={{ fontSize: 22 }}>{l.flag}</Text>
                    <Text style={[styles.langLabel, active && { color: theme.color.onBrand }]}>{l.label}</Text>
                    {active ? <Text style={[styles.langLabel, { color: theme.color.onBrand }]}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
          <Pressable testID="gate-continue" onPress={confirmLang} style={styles.primaryBtn}><Text style={styles.primaryText}>{t("login") === "Connexion" ? "Continuer" : "Continue"}</Text></Pressable>
        </View>
      </View>
    );
  }

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
  gateTitle: { color: theme.color.onSurface, fontSize: 26, fontWeight: "800", marginTop: theme.spacing.xl },
  gateSub: { color: theme.color.onSurfaceSecondary, fontSize: 13, marginTop: theme.spacing.sm },
  langRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 56, borderWidth: 1.5, borderColor: theme.color.border },
  langRowActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  langLabel: { flex: 1, fontSize: 16, fontWeight: "700", color: theme.color.onSurface },
  content: { flex: 1, justifyContent: "space-between", paddingHorizontal: theme.spacing.xl },
  brand: { color: "#fff", fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  headline: { color: "#fff", fontSize: 40, fontWeight: "800", lineHeight: 46, letterSpacing: -1 },
  subtitle: { color: "rgba(255,255,255,0.75)", fontSize: 16, marginTop: theme.spacing.md, marginBottom: theme.spacing.xl },
  primaryBtn: { backgroundColor: "#fff", height: 56, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.md },
  primaryText: { color: "#141414", fontSize: 16, fontWeight: "700" },
  secondaryBtn: { backgroundColor: "rgba(255,255,255,0.15)", height: 56, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
  secondaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});

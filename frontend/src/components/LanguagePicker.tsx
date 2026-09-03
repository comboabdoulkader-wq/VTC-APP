import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import { LANGS, useI18n, Lang } from "@/src/i18n";

/** Language selector (auto-detected from the device on first launch, saved locally and on the account). */
export default function LanguagePicker() {
  const { lang, setLang, t } = useI18n();
  const { token, user } = useAuth();
  const choose = async (l: Lang) => {
    await setLang(l);
    if (token && user) apiFetch("/auth/me", { method: "PATCH", body: JSON.stringify({ language: l }) }, token).catch(() => {});
  };
  return (
    <View style={styles.card} testID="language-picker">
      <View style={styles.head}><Icon name="translate" size={20} color={theme.color.onSurface} /><Text style={styles.title}>{t("language")}</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {LANGS.map((l) => {
          const active = l.code === lang;
          return (
            <Pressable key={l.code} testID={`lang-${l.code}`} onPress={() => choose(l.code)} style={[styles.chip, active && styles.chipActive]} accessibilityState={{ selected: active }}>
              <Text style={styles.flag}>{l.flag}</Text>
              <Text style={[styles.label, active && { color: theme.color.onBrand }]}>{l.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.xl },
  head: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  title: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  row: { gap: theme.spacing.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.pill, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border },
  chipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  flag: { fontSize: 16 },
  label: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
});

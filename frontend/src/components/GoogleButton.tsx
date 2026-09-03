import React from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useGoogleAuth } from "@/src/hooks/useGoogleAuth";
import { useI18n } from "@/src/i18n";

/** "Continue with Google" button + divider. The role is used only when the account does not exist yet. */
export default function GoogleButton({ role = "passenger" }: { role?: "passenger" | "driver" }) {
  const { signIn, busy, error } = useGoogleAuth();
  const { t } = useI18n();
  return (
    <View style={styles.wrap}>
      <View style={styles.divider}><View style={styles.line} /><Text style={styles.or}>{t("or")}</Text><View style={styles.line} /></View>
      <Pressable testID="google-signin" onPress={() => signIn(role)} disabled={busy} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }, busy && { opacity: 0.6 }]} accessibilityRole="button">
        {busy ? <ActivityIndicator color={theme.color.onSurface} /> : (
          <>
            <Icon name="google" size={20} color="#4285F4" />
            <Text style={styles.text}>{t("continue_google")}</Text>
          </>
        )}
      </Pressable>
      {error ? <Text style={styles.error} testID="google-error">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: theme.spacing.md },
  divider: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, marginBottom: theme.spacing.md },
  line: { flex: 1, height: 1, backgroundColor: theme.color.border },
  or: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontWeight: "700", textTransform: "uppercase" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing.sm, height: 56, borderRadius: theme.radius.pill, borderWidth: 1.5, borderColor: theme.color.borderStrong, backgroundColor: theme.color.surface },
  text: { fontSize: 16, fontWeight: "700", color: theme.color.onSurface },
  error: { color: theme.color.error, fontSize: 13, marginTop: theme.spacing.sm, textAlign: "center" },
});

import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import AccountSettings from "@/src/components/AccountSettings";

/** "Mon compte" menu shared by all profile screens: personal info, security (password), help. */
export default function AccountSection() {
  const [section, setSection] = useState<"info" | "security" | null>(null);
  return (
    <View style={styles.group} testID="account-section">
      <Row testID="menu-info" icon="account-edit-outline" label="Informations personnelles" onPress={() => setSection("info")} />
      <Row testID="menu-security" icon="shield-lock-outline" label="Sécurité" hint="Mot de passe" onPress={() => setSection("security")} />
      <Row testID="menu-help" icon="help-circle-outline" label="Aide" last onPress={() => Alert.alert("Aide", "Besoin d'assistance ? Écrivez-nous à support@ridego.app — nous répondons sous 24 h.")} />
      <AccountSettings visible={section !== null} section={section || "info"} onClose={() => setSection(null)} />
    </View>
  );
}

function Row({ icon, label, hint, onPress, last, testID }: { icon: string; label: string; hint?: string; onPress: () => void; last?: boolean; testID: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.item, last && { borderBottomWidth: 0 }, pressed && { backgroundColor: theme.color.surfaceTertiary }]}>
      <Icon name={icon as any} size={22} color={theme.color.onSurface} />
      <Text style={styles.label}>{label}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, overflow: "hidden", marginBottom: theme.spacing.xl },
  item: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, minHeight: 56, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  label: { flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: "500" },
  hint: { fontSize: 13, color: theme.color.onSurfaceTertiary, marginRight: theme.spacing.sm },
});

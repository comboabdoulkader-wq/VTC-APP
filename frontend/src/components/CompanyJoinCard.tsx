import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import { money } from "@/src/utils/format";

type Budget = { company: string | null; active?: boolean; budget_amount?: number | null; budget_period?: string; spent?: number; remaining?: number | null };
const PERIOD_FR: Record<string, string> = { day: "par jour", week: "par semaine", month: "par mois" };

/** Passenger profile block: join a company with an invite code, see the professional budget, leave. */
export default function CompanyJoinCard() {
  const { token } = useAuth();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setBudget(await apiFetch<Budget>("/company/my-budget", {}, token)); } catch {}
  }, [token]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const join = async () => {
    setError(null); setBusy(true);
    try { await apiFetch("/company/join", { method: "POST", body: JSON.stringify({ code }) }, token); setCode(""); load(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const leave = () => Alert.alert("Quitter l'entreprise", "Vous ne pourrez plus facturer vos courses à cette entreprise.", [
    { text: "Annuler", style: "cancel" },
    { text: "Quitter", style: "destructive", onPress: async () => { await apiFetch("/company/leave", { method: "POST" }, token); load(); } },
  ]);

  return (
    <View style={styles.card} testID="company-card">
      <View style={styles.head}>
        <Icon name="office-building-outline" size={20} color={theme.color.onSurface} />
        <Text style={styles.title}>Compte professionnel</Text>
      </View>
      {budget?.company ? (
        <>
          <Text style={styles.company}>{budget.company}{budget.active === false ? "  · accès suspendu" : ""}</Text>
          <Text style={styles.meta}>
            {budget.budget_amount == null ? "Budget illimité" : `Budget ${money(budget.budget_amount)} ${PERIOD_FR[budget.budget_period || "month"]} · dépensé ${money(budget.spent)} · reste ${money(budget.remaining)}`}
          </Text>
          {budget.budget_amount != null && (
            <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.min(100, ((budget.spent || 0) / Math.max(budget.budget_amount, 0.01)) * 100)}%` as any }]} /></View>
          )}
          <Pressable testID="company-leave" onPress={leave} style={styles.ghost}><Text style={styles.ghostText}>Quitter l'entreprise</Text></Pressable>
        </>
      ) : (
        <>
          <Text style={styles.meta}>Votre entreprise vous a donné un code ? Rejoignez son espace pour facturer vos déplacements professionnels.</Text>
          <View style={styles.row}>
            <TextInput testID="company-code-input" value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="CODE" autoCapitalize="characters" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} maxLength={12} />
            <Pressable testID="company-join" onPress={join} disabled={busy || code.length < 4} style={[styles.btn, (busy || code.length < 4) && { opacity: 0.5 }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Rejoindre</Text>}
            </Pressable>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.xl },
  head: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  title: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  company: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  meta: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 4, lineHeight: 18 },
  bar: { height: 6, borderRadius: 3, backgroundColor: theme.color.border, marginTop: theme.spacing.sm, overflow: "hidden" },
  barFill: { height: 6, backgroundColor: theme.color.success },
  row: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
  input: { flex: 1, backgroundColor: theme.color.surface, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 48, fontSize: 16, letterSpacing: 2, fontWeight: "700", color: theme.color.onSurface },
  btn: { backgroundColor: theme.color.brand, paddingHorizontal: theme.spacing.lg, height: 48, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "800" },
  ghost: { marginTop: theme.spacing.md, height: 40, alignItems: "center", justifyContent: "center" },
  ghostText: { color: theme.color.error, fontWeight: "700", fontSize: 13 },
  error: { color: theme.color.error, fontSize: 13, marginTop: theme.spacing.sm },
});

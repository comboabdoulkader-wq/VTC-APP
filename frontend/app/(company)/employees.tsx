import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Pressable, TextInput, Switch, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import SheetModal from "@/src/components/ui/SheetModal";
import { money } from "@/src/utils/format";

type Employee = { id: string; full_name: string; email: string; phone?: string | null; budget_amount: number | null; budget_period: "day" | "week" | "month" | null; company_active: boolean | null; spent: number; remaining: number | null; rides_count: number };
const PERIODS: { key: "day" | "week" | "month"; label: string }[] = [{ key: "day", label: "Par jour" }, { key: "week", label: "Par semaine" }, { key: "month", label: "Par mois" }];

export default function Employees() {
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const [list, setList] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sel, setSel] = useState<Employee | null>(null);
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<"day" | "week" | "month">("month");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setList(await apiFetch<Employee[]>("/company/employees", {}, token)); } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [token]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = (e: Employee) => { setSel(e); setAmount(e.budget_amount == null ? "" : String(e.budget_amount)); setPeriod(e.budget_period || "month"); };

  const patch = async (id: string, body: any) => {
    const e = await apiFetch<Employee>(`/company/employees/${id}`, { method: "PATCH", body: JSON.stringify(body) }, token);
    setList((l) => l.map((x) => (x.id === id ? e : x))); setSel((s) => (s && s.id === id ? e : s));
    return e;
  };

  const saveBudget = async () => {
    if (!sel) return;
    const n = amount.trim() === "" ? null : parseFloat(amount.replace(",", "."));
    if (n != null && (isNaN(n) || n < 0)) { Alert.alert("Montant invalide"); return; }
    setSaving(true);
    try { await patch(sel.id, { budget_amount: n ?? 0, budget_period: period }); setSel(null); } catch (e: any) { Alert.alert("Erreur", e.message); } finally { setSaving(false); }
  };

  const remove = (e: Employee) => Alert.alert("Retirer l'employé", `${e.full_name} ne pourra plus facturer de courses à l'entreprise.`, [
    { text: "Annuler", style: "cancel" },
    { text: "Retirer", style: "destructive", onPress: async () => { await apiFetch(`/company/employees/${e.id}`, { method: "DELETE" }, token); setSel(null); load(); } },
  ]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="employees-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Employés</Text>
        <Text style={styles.subtitle}>Invitez avec le code <Text style={{ fontWeight: "800", color: theme.color.onSurface }}>{user?.invite_code}</Text> · budgets et accès</Text>
      </View>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.onSurface} /> : (
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.sm, paddingBottom: insets.bottom + 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
          {list.length === 0 ? (
            <View style={styles.empty}>
              <Icon name="account-multiple-plus-outline" size={56} color={theme.color.onSurfaceTertiary} />
              <Text style={styles.emptyText}>Aucun employé pour l'instant</Text>
              <Text style={styles.emptyHint}>Vos employés saisissent le code {user?.invite_code} dans Profil → Compte professionnel de l'app passager.</Text>
            </View>
          ) : list.map((e) => {
            const pct = e.budget_amount ? Math.min(100, (e.spent / e.budget_amount) * 100) : 0;
            return (
              <Pressable key={e.id} testID={`employee-${e.id}`} onPress={() => open(e)} style={[styles.card, e.company_active === false && { opacity: 0.55 }]}>
                <View style={styles.rowBetween}>
                  <Text style={styles.name}>{e.full_name}{e.company_active === false ? " · bloqué" : ""}</Text>
                  <Text style={styles.spent}>{money(e.spent)}</Text>
                </View>
                <Text style={styles.meta}>{e.email} · {e.rides_count} course{e.rides_count > 1 ? "s" : ""}</Text>
                <Text style={styles.meta}>{e.budget_amount == null ? "Budget illimité" : `Budget ${money(e.budget_amount)} ${PERIODS.find((p) => p.key === e.budget_period)?.label.toLowerCase()} · reste ${money(e.remaining)}`}</Text>
                {e.budget_amount != null && <View style={styles.bar}><View style={[styles.barFill, { width: `${pct}%` as any, backgroundColor: pct >= 90 ? theme.color.error : theme.color.success }]} /></View>}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <SheetModal visible={!!sel} onClose={() => setSel(null)} title={sel?.full_name || ""} subtitle={sel?.email} testID="employee-detail"
        footer={<Pressable testID="budget-save" onPress={saveBudget} disabled={saving} style={styles.primary}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Enregistrer le budget</Text>}</Pressable>}>
        {sel && (
          <>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}><Text style={styles.label}>Accès autorisé</Text><Text style={styles.hint}>Désactivez pour bloquer les courses professionnelles</Text></View>
              <Switch testID="employee-active-switch" value={sel.company_active !== false} onValueChange={(v) => { patch(sel.id, { company_active: v }).catch(() => {}); }} trackColor={{ true: theme.color.success, false: theme.color.borderStrong }} thumbColor="#fff" />
            </View>
            <Text style={styles.label}>Budget (€)</Text>
            <TextInput testID="budget-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="ex. 150" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
            <Text style={styles.label}>Période</Text>
            <View style={styles.chips}>
              {PERIODS.map((p) => (
                <Pressable key={p.key} testID={`period-${p.key}`} onPress={() => setPeriod(p.key)} style={[styles.chip, period === p.key && styles.chipActive]}><Text style={[styles.chipText, period === p.key && { color: "#fff" }]}>{p.label}</Text></Pressable>
              ))}
            </View>
            <View style={styles.kpis}>
              <View style={styles.kpi}><Text style={styles.kpiVal}>{money(sel.spent)}</Text><Text style={styles.kpiLabel}>dépensé</Text></View>
              <View style={styles.kpi}><Text style={styles.kpiVal}>{sel.remaining == null ? "∞" : money(sel.remaining)}</Text><Text style={styles.kpiLabel}>restant</Text></View>
              <View style={styles.kpi}><Text style={styles.kpiVal}>{sel.rides_count}</Text><Text style={styles.kpiLabel}>courses</Text></View>
            </View>
            <Pressable testID="employee-remove" onPress={() => remove(sel)} style={styles.removeBtn}><Text style={styles.removeText}>Retirer de l'entreprise</Text></Pressable>
          </>
        )}
      </SheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg },
  title: { fontSize: 30, fontWeight: "800", color: theme.color.onSurface, letterSpacing: -1 },
  subtitle: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  empty: { alignItems: "center", paddingVertical: 50, gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
  emptyText: { fontSize: 16, fontWeight: "700", color: theme.color.onSurface },
  emptyHint: { fontSize: 13, color: theme.color.onSurfaceSecondary, textAlign: "center" },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, gap: 3 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  spent: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  meta: { fontSize: 12, color: theme.color.onSurfaceSecondary },
  bar: { height: 6, borderRadius: 3, backgroundColor: theme.color.border, marginTop: 6, overflow: "hidden" },
  barFill: { height: 6 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, marginBottom: theme.spacing.lg },
  label: { fontSize: 13, fontWeight: "700", color: theme.color.onSurfaceSecondary, marginBottom: theme.spacing.sm },
  hint: { fontSize: 12, color: theme.color.onSurfaceTertiary },
  input: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 50, fontSize: 16, color: theme.color.onSurface, marginBottom: theme.spacing.lg },
  chips: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  chip: { paddingHorizontal: theme.spacing.lg, height: 40, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: theme.color.brand },
  chipText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  kpis: { flexDirection: "row", gap: theme.spacing.sm },
  kpi: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, alignItems: "center" },
  kpiVal: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  kpiLabel: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  removeBtn: { marginTop: theme.spacing.xl, height: 46, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary },
  removeText: { color: theme.color.error, fontWeight: "700" },
  primary: { backgroundColor: theme.color.brand, height: 54, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});

import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { apiFetch, useAuth } from "@/src/context/auth";
import AccountingExport from "@/src/components/AccountingExport";
import { money, fmtDateTime, STATUS_LABELS } from "@/src/utils/format";

type Overview = { employees_count: number; active_employees: number; spent_month: number; budget_total: number; active_rides: number; invite_code: string; company_name: string };
const ACTIVE = ["requested", "accepted", "in_progress"];

export default function CompanyDashboard() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [rides, setRides] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, r] = await Promise.all([apiFetch<Overview>("/company/overview", {}, token), apiFetch<any[]>("/company/rides", {}, token)]);
      setOverview(o); setRides(r);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]));

  const live = rides.filter((r) => ACTIVE.includes(r.status));
  const history = rides.filter((r) => !ACTIVE.includes(r.status));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.color.surface }} testID="company-dashboard"
      contentContainerStyle={{ paddingTop: insets.top + theme.spacing.lg, paddingBottom: insets.bottom + 40, paddingHorizontal: theme.spacing.xl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
      <Text style={styles.title}>{overview?.company_name || t("tab_dashboard")}</Text>
      <Text style={styles.subtitle}>{t("company_subtitle")}</Text>

      {loading && !overview ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.onSurface} /> : overview && (
        <>
          <View style={styles.hero} testID="company-overview">
            <Text style={styles.heroLabel}>Dépenses ce mois</Text>
            <Text style={styles.heroValue}>{money(overview.spent_month)}</Text>
            <Text style={styles.heroMeta}>Budget alloué : {money(overview.budget_total)} · {overview.employees_count} employé{overview.employees_count > 1 ? "s" : ""} · {overview.active_rides} course{overview.active_rides > 1 ? "s" : ""} en cours</Text>
            <View style={styles.codeBox}>
              <Icon name="key-variant" size={16} color="#fff" />
              <Text style={styles.codeLabel}>Code d'invitation :</Text>
              <Text style={styles.code} testID="invite-code">{overview.invite_code}</Text>
            </View>
          </View>

          <Text style={styles.section}>En direct ({live.length})</Text>
          {live.length === 0 ? <Text style={styles.empty}>Aucune course professionnelle en cours</Text> : live.map((r) => <RideRow key={r.id} r={r} />)}

          <Text style={styles.section}>Historique</Text>
          {history.length === 0 ? <Text style={styles.empty}>Aucune course terminée</Text> : history.slice(0, 30).map((r) => <RideRow key={r.id} r={r} />)}

          <AccountingExport basePath="/company" groupLabel="employé" showCommission={false} />
        </>
      )}
    </ScrollView>
  );
}

function RideRow({ r }: { r: any }) {
  const st = STATUS_LABELS[r.status];
  return (
    <View style={styles.card} testID={`company-ride-${r.id}`}>
      <View style={styles.rowBetween}>
        <Text style={styles.emp}>{r.passenger_name}{r.passenger_label ? ` (${r.passenger_label})` : ""}</Text>
        <View style={[styles.badge, { backgroundColor: st.color + "22" }]}><Text style={[styles.badgeText, { color: st.color }]}>{st.label}</Text></View>
      </View>
      <Text style={styles.route} numberOfLines={1}>● {r.pickup.address}</Text>
      <Text style={styles.route} numberOfLines={1}>▼ {r.dropoff.address}</Text>
      <View style={styles.rowBetween}>
        <Text style={styles.meta}>{fmtDateTime(r.scheduled_at || r.created_at)}{r.driver_name ? ` · ${r.driver_name}` : ""}</Text>
        <Text style={styles.price}>{money(r.price)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 30, fontWeight: "800", color: theme.color.onSurface, letterSpacing: -1 },
  subtitle: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginBottom: theme.spacing.lg },
  hero: { backgroundColor: theme.color.brand, borderRadius: theme.radius.lg, padding: theme.spacing.xl, marginBottom: theme.spacing.lg },
  heroLabel: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600" },
  heroValue: { color: "#fff", fontSize: 36, fontWeight: "800", letterSpacing: -1 },
  heroMeta: { color: "rgba(255,255,255,0.8)", fontSize: 13, marginTop: 6 },
  codeBox: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: theme.spacing.md, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: theme.radius.md, padding: theme.spacing.sm },
  codeLabel: { color: "rgba(255,255,255,0.8)", fontSize: 12 },
  code: { color: "#fff", fontWeight: "800", fontSize: 16, letterSpacing: 2 },
  section: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  empty: { fontSize: 13, color: theme.color.onSurfaceTertiary, paddingVertical: theme.spacing.sm },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm, gap: 4 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  emp: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill },
  badgeText: { fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  route: { fontSize: 13, color: theme.color.onSurface },
  meta: { fontSize: 12, color: theme.color.onSurfaceTertiary },
  price: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
});

import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import { money } from "@/src/utils/format";
import SheetModal from "@/src/components/ui/SheetModal";

type Data = {
  rides: { total: number; completed: number; cancelled: number; in_progress: number; requested: number; accepted: number };
  cancellation_rate: number; revenue: number; commissions: number; cashback_paid: number;
  users: { passengers: number; drivers: number; companies: number; total: number };
  daily: { day: string; rides: number; revenue: number }[];
};

/** Étape 18 — Admin KPI dashboard. */
export default function AdminDashboard({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { setD(await apiFetch<Data>("/admin/dashboard", {}, token)); } catch { setD(null); } finally { setLoading(false); } }, [token]);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  const maxR = Math.max(1, ...(d?.daily || []).map((x) => x.rides));

  return (
    <SheetModal visible={visible} onClose={onClose} title="Tableau de bord" subtitle="Vue d'ensemble de la plateforme" testID="admin-dashboard">
      {loading || !d ? <ActivityIndicator style={{ marginVertical: 24 }} color={theme.color.onSurface} /> : (
        <>
          <View style={styles.grid}>
            <Kpi icon="car" label="Courses" value={String(d.rides.total)} sub={`${d.rides.completed} terminées`} />
            <Kpi icon="cash-multiple" label="Revenus" value={money(d.revenue)} color={theme.color.success} />
            <Kpi icon="percent" label="Commissions" value={money(d.commissions)} />
            <Kpi icon="gift-outline" label="Cashback versé" value={money(d.cashback_paid)} />
            <Kpi icon="close-circle-outline" label="Annulations" value={`${d.cancellation_rate}%`} sub={`${d.rides.cancelled} courses`} color={theme.color.error} />
            <Kpi icon="account-group" label="Utilisateurs" value={String(d.users.total)} sub={`${d.users.drivers} chauffeurs`} />
          </View>

          <Text style={styles.section}>En temps réel</Text>
          <View style={styles.liveRow}>
            <Live label="Demandées" n={d.rides.requested} />
            <Live label="Acceptées" n={d.rides.accepted} />
            <Live label="En cours" n={d.rides.in_progress} />
          </View>

          <Text style={styles.section}>Courses (30 derniers jours)</Text>
          {d.daily.length ? d.daily.map((x) => (
            <View key={x.day} style={styles.barRow} testID={`daily-${x.day}`}>
              <Text style={styles.barDay}>{x.day}</Text>
              <View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.round((x.rides / maxR) * 100)}%` }]} /></View>
              <Text style={styles.barVal}>{x.rides}</Text>
              <Text style={styles.barRev}>{money(x.revenue)}</Text>
            </View>
          )) : <Text style={styles.empty}>Aucune donnée sur la période.</Text>}
        </>
      )}
    </SheetModal>
  );
}

const Kpi = ({ icon, label, value, sub, color }: any) => (
  <View style={styles.kpi}>
    <Icon name={icon} size={20} color={color || theme.color.onSurfaceSecondary} />
    <Text style={[styles.kpiVal, color && { color }]}>{value}</Text>
    <Text style={styles.kpiLabel}>{label}</Text>
    {sub ? <Text style={styles.kpiSub}>{sub}</Text> : null}
  </View>
);
const Live = ({ label, n }: { label: string; n: number }) => (
  <View style={styles.live}><Text style={styles.liveN}>{n}</Text><Text style={styles.liveLabel}>{label}</Text></View>
);

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  kpi: { flexGrow: 1, flexBasis: "30%", minWidth: 100, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md },
  kpiVal: { fontSize: 20, fontWeight: "800", color: theme.color.onSurface, marginTop: 6 },
  kpiLabel: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  kpiSub: { fontSize: 10, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  section: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  liveRow: { flexDirection: "row", gap: theme.spacing.sm },
  live: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, alignItems: "center" },
  liveN: { fontSize: 22, fontWeight: "800", color: theme.color.onSurface }, liveLabel: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  barRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginBottom: 6 },
  barDay: { fontSize: 11, color: theme.color.onSurfaceTertiary, width: 42 },
  barTrack: { flex: 1, height: 14, backgroundColor: theme.color.surfaceSecondary, borderRadius: 7, overflow: "hidden" },
  barFill: { height: 14, backgroundColor: theme.color.brand, borderRadius: 7 },
  barVal: { fontSize: 12, fontWeight: "800", color: theme.color.onSurface, width: 28, textAlign: "right" },
  barRev: { fontSize: 11, color: theme.color.onSurfaceSecondary, width: 60, textAlign: "right" },
  empty: { fontSize: 13, color: theme.color.onSurfaceTertiary },
});

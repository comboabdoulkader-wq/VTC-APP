import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { apiFetch, useAuth } from "@/src/context/auth";

type Ride = any;

type Stats = { online_hours_week: number; online_hours_total: number; acceptance_rate: number | null; accepted: number; declined: number; completed: number; completion_rate: number | null; best_slots: { label: string; count: number; earnings: number }[]; earnings_by_day: { day: string; amount: number }[]; avg_rating: number };
type Earnings = { cancellation_fees?: number; total: number; commission: number; net: number; rides_count: number; commission_rate: number; platform: { count: number; gross: number }; private: { count: number; gross: number; commission: number } };
const EMPTY: Earnings = { total: 0, commission: 0, net: 0, rides_count: 0, commission_rate: 0.15, platform: { count: 0, gross: 0 }, private: { count: 0, gross: 0, commission: 0 } };

export default function Earnings() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [earnings, setEarnings] = useState<Earnings>(EMPTY);
  const [stats, setStats] = useState<Stats | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [e, r, st] = await Promise.all([
        apiFetch<any>("/driver/earnings", {}, token),
        apiFetch<Ride[]>("/rides/mine", {}, token),
        apiFetch<Stats>("/driver/stats", {}, token).catch(() => null),
      ]);
      setEarnings(e);
      setStats(st);
      setRides(r.filter((x) => x.status === "completed"));
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.color.surface }}
      contentContainerStyle={{ paddingTop: insets.top + theme.spacing.lg, paddingBottom: insets.bottom + theme.spacing.xxl, paddingHorizontal: theme.spacing.xl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      testID="earnings-screen"
    >
      <Text style={styles.title}>{t("my_earnings")}</Text>

      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Net chauffeur</Text>
        <Text style={styles.heroValue} maxFontSizeMultiplier={1.2} adjustsFontSizeToFit numberOfLines={1}>{earnings.net.toFixed(2)} €</Text>
        <Text style={styles.heroMeta}>{earnings.rides_count} course{earnings.rides_count > 1 ? "s" : ""} terminée{earnings.rides_count > 1 ? "s" : ""} · brut {earnings.total.toFixed(2)} €</Text>
      </View>

      <View style={styles.split} testID="earnings-split">
        <View style={styles.splitCard}>
          <Icon name="cellphone" size={20} color={theme.color.onSurface} />
          <Text style={styles.splitLabel}>Plateforme</Text>
          <Text style={styles.splitVal}>{earnings.platform.gross.toFixed(2)} €</Text>
          <Text style={styles.splitMeta}>{earnings.platform.count} course{earnings.platform.count > 1 ? "s" : ""} · 0 % commission</Text>
        </View>
        <View style={styles.splitCard}>
          <Icon name="notebook-outline" size={20} color={theme.color.onSurface} />
          <Text style={styles.splitLabel}>Privées</Text>
          <Text style={styles.splitVal}>{earnings.private.gross.toFixed(2)} €</Text>
          <Text style={[styles.splitMeta, { color: theme.color.warning }]}>− {earnings.private.commission.toFixed(2)} € ({Math.round(earnings.commission_rate * 100)} %)</Text>
        </View>
      </View>

      {stats && (
        <View testID="driver-stats">
          <Text style={styles.section}>Statistiques</Text>
          <View style={styles.split}>
            <View style={styles.splitCard}><Icon name="clock-outline" size={20} color={theme.color.onSurface} /><Text style={styles.splitLabel}>En ligne (7 j)</Text><Text style={styles.splitVal}>{stats.online_hours_week} h</Text><Text style={styles.splitMeta}>{stats.online_hours_total} h au total</Text></View>
            <View style={styles.splitCard}><Icon name="check-decagram-outline" size={20} color={theme.color.onSurface} /><Text style={styles.splitLabel}>Acceptation</Text><Text style={styles.splitVal}>{stats.acceptance_rate == null ? "—" : `${stats.acceptance_rate} %`}</Text><Text style={styles.splitMeta}>{stats.accepted} acceptées · {stats.declined} refusées</Text></View>
          </View>
          <View style={styles.splitCard}>
            <Text style={styles.splitLabel}>Meilleurs créneaux de la semaine</Text>
            {stats.best_slots.length === 0 ? <Text style={styles.splitMeta}>Terminez des courses pour découvrir vos meilleurs créneaux</Text> : stats.best_slots.map((b, i) => (
              <View key={b.label} style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                <Text style={styles.rowAddr}>{["🥇", "🥈", "🥉"][i]} {b.label}</Text>
                <Text style={styles.rowPrice}>{b.earnings.toFixed(2)} € · {b.count} course{b.count > 1 ? "s" : ""}</Text>
              </View>
            ))}
            <View style={{ flexDirection: "row", gap: 4, marginTop: theme.spacing.md, alignItems: "flex-end", height: 60 }}>
              {stats.earnings_by_day.map((d) => { const max = Math.max(...stats.earnings_by_day.map((x) => x.amount), 1); return (
                <View key={d.day} style={{ flex: 1, alignItems: "center" }}>
                  <View style={{ width: "70%", height: Math.max(4, (d.amount / max) * 44), backgroundColor: d.amount > 0 ? theme.color.brand : theme.color.border, borderRadius: 3 }} />
                  <Text style={{ fontSize: 9, color: theme.color.onSurfaceTertiary, marginTop: 2 }}>{d.day}</Text>
                </View>); })}
            </View>
          </View>
          {(earnings.cancellation_fees || 0) > 0 && <Text style={[styles.splitMeta, { marginTop: theme.spacing.sm }]}>+ {earnings.cancellation_fees!.toFixed(2)} € de frais d'annulation perçus</Text>}
        </View>
      )}

      <Text style={styles.section}>Historique</Text>
      {loading ? (
        <ActivityIndicator color={theme.color.onSurface} style={{ marginTop: 20 }} />
      ) : rides.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="cash-remove" size={48} color={theme.color.onSurfaceTertiary} />
          <Text style={styles.emptyText}>Aucune course terminée</Text>
        </View>
      ) : (
        rides.map((r) => (
          <View key={r.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowDate}>{new Date(r.completed_at || r.created_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })} · {r.source === "private" ? "Privée" : "Plateforme"}{r.payment_method === "card" ? " · 💳" : ""}</Text>
              <Text style={styles.rowAddr} numberOfLines={1}>{r.dropoff.address}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.rowPrice}>+{r.price.toFixed(2)} €</Text>
              {r.commission_amount > 0 && <Text style={styles.rowCommission}>− {r.commission_amount.toFixed(2)} €</Text>}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 32, fontWeight: "800", color: theme.color.onSurface, marginBottom: theme.spacing.lg, letterSpacing: -1 },
  hero: { backgroundColor: theme.color.brand, borderRadius: theme.radius.lg, padding: theme.spacing.xl, marginBottom: theme.spacing.md },
  split: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.xl },
  splitCard: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, gap: 2 },
  splitLabel: { fontSize: 12, fontWeight: "700", color: theme.color.onSurfaceSecondary, marginTop: 4 },
  splitVal: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  splitMeta: { fontSize: 11, color: theme.color.onSurfaceTertiary, fontWeight: "600" },
  rowCommission: { fontSize: 11, color: theme.color.warning, fontWeight: "700" },
  heroLabel: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: "600" },
  heroValue: { color: "#fff", fontSize: 40, fontWeight: "800", marginTop: 4, letterSpacing: -1 },
  heroMeta: { color: "rgba(255,255,255,0.7)", fontSize: 14, marginTop: 8 },
  section: { fontSize: 16, fontWeight: "700", color: theme.color.onSurface, marginBottom: theme.spacing.md },
  empty: { alignItems: "center", paddingVertical: 40, gap: theme.spacing.md },
  emptyText: { color: theme.color.onSurfaceTertiary, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  rowDate: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontWeight: "600" },
  rowAddr: { fontSize: 14, color: theme.color.onSurface, fontWeight: "500", marginTop: 2 },
  rowPrice: { fontSize: 16, fontWeight: "800", color: theme.color.success },
});

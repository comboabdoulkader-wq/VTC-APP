import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, RefreshControl, ActivityIndicator, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import { useI18n } from "@/src/i18n";
import { money, fmtTime } from "@/src/utils/format";

type Ride = any;

function dayKey(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

function countdownLabel(iso: string) {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (mins <= 0) return "maintenant";
  if (mins < 60) return `dans ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `dans ${h} h ${m}` : `dans ${h} h`;
  const days = Math.round(h / 24);
  return `dans ${days} j`;
}

export default function DriverPlanning() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setRides(await apiFetch<Ride[]>("/driver/planning", {}, token)); }
    catch { setRides([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const groups: { day: string; items: Ride[] }[] = [];
  for (const r of rides) {
    if (!r.scheduled_at) continue;
    const k = dayKey(r.scheduled_at);
    const g = groups.find((x) => x.day === k);
    if (g) g.items.push(r); else groups.push({ day: k, items: [r] });
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="driver-planning">
      <View style={styles.header}>
        <Icon name="calendar-clock" size={26} color={theme.color.onSurface} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("tab_planning")}</Text>
          <Text style={styles.subtitle}>Vos courses réservées à l'avance</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={theme.color.onSurface} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          showsVerticalScrollIndicator={false}
        >
          {groups.length === 0 ? (
            <View style={styles.empty} testID="planning-empty">
              <Icon name="calendar-blank-outline" size={48} color={theme.color.onSurfaceTertiary} />
              <Text style={styles.emptyTitle}>Aucune course programmée</Text>
              <Text style={styles.emptyText}>Les courses que vous réservez à l'avance apparaîtront ici avec un rappel avant le départ.</Text>
            </View>
          ) : groups.map((g) => (
            <View key={g.day} style={{ marginBottom: theme.spacing.lg }}>
              <Text style={styles.dayLabel}>{g.day}</Text>
              {g.items.map((r) => (
                <Pressable key={r.id} testID={`planning-ride-${r.id}`} onPress={() => router.push(`/(driver)`)} style={styles.card}>
                  <View style={styles.timeCol}>
                    <Text style={styles.time}>{fmtTime(r.scheduled_at)}</Text>
                    <View style={styles.countPill}><Text style={styles.countText}>{countdownLabel(r.scheduled_at)}</Text></View>
                  </View>
                  <View style={styles.divider} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.pass} numberOfLines={1}>{r.passenger_label || r.passenger_name}</Text>
                      <Text style={styles.price}>{money(r.price)}</Text>
                    </View>
                    <View style={styles.routeRow}><View style={[styles.dot, { backgroundColor: theme.color.success }]} /><Text style={styles.addr} numberOfLines={1}>{r.pickup.address}</Text></View>
                    <View style={styles.routeRow}><Icon name="map-marker" size={13} color={theme.color.error} /><Text style={styles.addr} numberOfLines={1}>{r.dropoff.address}</Text></View>
                    <View style={styles.tags}>
                      <Text style={styles.tag}>{r.vehicle_type?.toUpperCase()}</Text>
                      <Text style={styles.tag}>{r.status === "in_progress" ? "En cours" : "Réservée"}</Text>
                      <Text style={styles.tag}>{r.payment_method === "card" ? "💳 Carte" : "💵 Espèces"}</Text>
                      {r.assigned_by_name ? <Text style={styles.tag}>🧭 {r.assigned_by_name}</Text> : null}
                    </View>
                  </View>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  title: { fontSize: 22, fontWeight: "800", color: theme.color.onSurface },
  subtitle: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  empty: { alignItems: "center", justifyContent: "center", paddingTop: 60, gap: theme.spacing.md, paddingHorizontal: theme.spacing.xl },
  emptyTitle: { fontSize: 17, fontWeight: "700", color: theme.color.onSurface },
  emptyText: { fontSize: 14, color: theme.color.onSurfaceSecondary, textAlign: "center", lineHeight: 20 },
  dayLabel: { fontSize: 13, fontWeight: "800", color: theme.color.onSurfaceSecondary, textTransform: "capitalize", marginBottom: theme.spacing.sm },
  card: { flexDirection: "row", backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm, gap: theme.spacing.md },
  timeCol: { alignItems: "center", justifyContent: "center", gap: 6, minWidth: 62 },
  time: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  countPill: { backgroundColor: theme.color.brand, borderRadius: theme.radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  countText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  divider: { width: 1, backgroundColor: theme.color.border },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pass: { flex: 1, fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  price: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  routeRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginTop: 4 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  addr: { flex: 1, fontSize: 13, color: theme.color.onSurfaceSecondary },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: theme.spacing.sm },
  tag: { fontSize: 10, fontWeight: "700", color: theme.color.onSurfaceSecondary, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 7, paddingVertical: 2, borderRadius: theme.radius.pill },
});

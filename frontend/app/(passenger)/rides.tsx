import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { apiFetch, useAuth } from "@/src/context/auth";
import { fmtDateTime } from "@/src/utils/format";

type Ride = {
  id: string; booking_ref?: string | null; service_type?: string; service_label?: string; flight?: any; pickup: any; dropoff: any; price: number; status: string;
  created_at: string; vehicle_type: string; rating?: number; driver_name?: string;
  scheduled_at?: string | null; passenger_label?: string | null; surcharge_enabled?: boolean;
  payment_method?: string; payment_status?: string; driver_eta_min?: number | null;
};

const ACTIVE = ["requested", "accepted", "in_progress"];

const STATUS_COLORS: Record<string, string> = {
  requested: theme.color.warning, accepted: theme.color.success, in_progress: theme.color.success, completed: theme.color.onSurfaceSecondary, cancelled: theme.color.error,
};

export default function Rides() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<Ride[]>("/rides/mine", {}, token);
      setRides(r);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]));

  const sorted = [...rides].sort((a, b) => Number(ACTIVE.includes(b.status)) - Number(ACTIVE.includes(a.status)));
  const activeCount = rides.filter((r) => ACTIVE.includes(r.status)).length;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="rides-screen">
      <View style={styles.header}>
        <Text style={styles.title}>{t("tab_rides")}</Text>
        {activeCount > 0 && <Text style={styles.subtitle}>{activeCount} en cours · suivi en temps réel</Text>}
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.onSurface} />
      ) : rides.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="car-off" size={56} color={theme.color.onSurfaceTertiary} />
          <Text style={styles.emptyText}>{t("no_rides")}</Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.onSurface} />}
          renderItem={({ item }) => {
            const status = { color: STATUS_COLORS[item.status] || STATUS_COLORS.completed, label: t(`st_${item.status}` as any) };
            const isActive = ACTIVE.includes(item.status);
            return (
              <Pressable
                testID={`ride-card-${item.id}`}
                style={[styles.card, isActive && styles.cardActive]}
                onPress={() => router.push(`/(passenger)/ride/${item.id}`)}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.date}>
                    {item.booking_ref ? `${item.booking_ref} · ` : ""}{item.scheduled_at ? `📅 ${fmtDateTime(item.scheduled_at)}` : new Date(item.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </Text>
                  <View style={[styles.badge, { backgroundColor: status.color + "22" }]}>
                    <Text style={[styles.badgeText, { color: status.color }]}>{status.label}</Text>
                  </View>
                </View>
                {(item.passenger_label || item.surcharge_enabled || (item.service_type && item.service_type !== "private") || item.flight?.number) && (
                  <View style={styles.tags}>
                    {item.service_type && item.service_type !== "private" ? <Text style={styles.tag}>{item.service_label}</Text> : null}
                    {item.flight?.number ? <Text style={styles.tag}>✈️ {item.flight.number}</Text> : null}
                    {item.passenger_label ? <Text style={styles.tag}>👤 {item.passenger_label}</Text> : null}
                    {item.surcharge_enabled ? <Text style={styles.tag}>⚡ Rallonge</Text> : null}
                    {item.payment_method === "card" ? <Text style={styles.tag}>💳 {item.payment_status === "paid" ? "Payé" : "Carte"}</Text> : null}
                  </View>
                )}
                <View style={styles.route}>
                  <Icon name="circle" size={10} color={theme.color.success} />
                  <Text style={styles.routeText} numberOfLines={1}>{item.pickup.address}</Text>
                </View>
                <View style={styles.route}>
                  <Icon name="map-marker" size={12} color={theme.color.error} />
                  <Text style={styles.routeText} numberOfLines={1}>{item.dropoff.address}</Text>
                </View>
                <View style={styles.cardFooter}>
                  <Text style={styles.driver}>{item.driver_name ? `${item.driver_name}${item.driver_eta_min != null && isActive ? ` · ${item.driver_eta_min} min` : ""}` : t("searching_driver")}</Text>
                  <Text style={styles.price}>{item.price.toFixed(2)} €</Text>
                </View>
                {!isActive && (
                  <Pressable testID={`book-again-${item.id}`} onPress={() => router.push({ pathname: "/(passenger)", params: { rebook: item.id } } as any)} style={styles.again} hitSlop={6}>
                    <Icon name="refresh" size={16} color={theme.color.onSurface} />
                    <Text style={styles.againText}>{t("book_again")}</Text>
                  </Pressable>
                )}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  again: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: theme.spacing.md, height: 40, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.borderStrong },
  againText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg },
  title: { fontSize: 32, fontWeight: "800", color: theme.color.onSurface, letterSpacing: -1 },
  subtitle: { fontSize: 13, color: theme.color.success, fontWeight: "700", marginTop: 4 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing.md },
  emptyText: { fontSize: 16, color: theme.color.onSurfaceTertiary, fontWeight: "600" },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, borderWidth: 2, borderColor: "transparent" },
  cardActive: { borderColor: theme.color.success, backgroundColor: "#F6FBF8" },
  tags: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.sm, flexWrap: "wrap" },
  tag: { fontSize: 12, fontWeight: "600", color: theme.color.onSurfaceSecondary, backgroundColor: theme.color.surface, paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing.md },
  date: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: "600" },
  badge: { paddingHorizontal: theme.spacing.sm, paddingVertical: 4, borderRadius: theme.radius.pill },
  badgeText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  route: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginBottom: 6 },
  routeText: { flex: 1, fontSize: 14, color: theme.color.onSurface, fontWeight: "500" },
  cardFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: theme.spacing.md, paddingTop: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.color.border },
  driver: { fontSize: 13, color: theme.color.onSurfaceSecondary },
  price: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
});

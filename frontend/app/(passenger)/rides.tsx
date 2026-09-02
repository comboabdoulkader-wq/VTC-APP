import { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";

type Ride = {
  id: string; pickup: any; dropoff: any; price: number; status: string;
  created_at: string; vehicle_type: string; rating?: number; driver_name?: string;
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  requested: { label: "En attente", color: theme.color.warning },
  accepted: { label: "Accepté", color: theme.color.success },
  in_progress: { label: "En cours", color: theme.color.success },
  completed: { label: "Terminée", color: theme.color.onSurfaceSecondary },
  cancelled: { label: "Annulée", color: theme.color.error },
};

export default function Rides() {
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

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="rides-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Mes courses</Text>
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.onSurface} />
      ) : rides.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="car-off" size={56} color={theme.color.onSurfaceTertiary} />
          <Text style={styles.emptyText}>Aucune course pour le moment</Text>
        </View>
      ) : (
        <FlatList
          data={rides}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={theme.color.onSurface} />}
          renderItem={({ item }) => {
            const status = STATUS_LABELS[item.status] || STATUS_LABELS.completed;
            return (
              <View
                testID={`ride-card-${item.id}`}
                style={styles.card}
                onTouchEnd={() => router.push(`/(passenger)/ride/${item.id}`)}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.date}>{new Date(item.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
                  <View style={[styles.badge, { backgroundColor: status.color + "22" }]}>
                    <Text style={[styles.badgeText, { color: status.color }]}>{status.label}</Text>
                  </View>
                </View>
                <View style={styles.route}>
                  <Icon name="circle" size={10} color={theme.color.success} />
                  <Text style={styles.routeText} numberOfLines={1}>{item.pickup.address}</Text>
                </View>
                <View style={styles.route}>
                  <Icon name="map-marker" size={12} color={theme.color.error} />
                  <Text style={styles.routeText} numberOfLines={1}>{item.dropoff.address}</Text>
                </View>
                <View style={styles.cardFooter}>
                  <Text style={styles.driver}>{item.driver_name || "En recherche"}</Text>
                  <Text style={styles.price}>{item.price.toFixed(2)} €</Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg },
  title: { fontSize: 32, fontWeight: "800", color: theme.color.onSurface, letterSpacing: -1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing.md },
  emptyText: { fontSize: 16, color: theme.color.onSurfaceTertiary, fontWeight: "600" },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg },
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

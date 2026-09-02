import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import MapCanvas from "@/src/components/MapCanvas";
import { apiFetch, useAuth } from "@/src/context/auth";
import { DEFAULT_PICKUP } from "@/src/data/places";

type Ride = any;

export default function DriverHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const [online, setOnline] = useState(false);
  const [rides, setRides] = useState<Ride[]>([]);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadActive = useCallback(async () => {
    try {
      const r = await apiFetch<Ride>("/rides/active", {}, token);
      setActiveRide(r);
    } catch { setActiveRide(null); }
  }, [token]);

  const loadAvailable = useCallback(async () => {
    if (!online) { setRides([]); return; }
    setLoading(true);
    try {
      const r = await apiFetch<Ride[]>("/rides/available", {}, token);
      setRides(r);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [online, token]);

  useFocusEffect(useCallback(() => {
    loadActive();
    loadAvailable();
  }, [loadActive, loadAvailable]));

  useEffect(() => {
    if (!online || activeRide) return;
    const t = setInterval(loadAvailable, 5000);
    return () => clearInterval(t);
  }, [online, activeRide, loadAvailable]);

  useEffect(() => { loadAvailable(); }, [online, loadAvailable]);

  const toggleOnline = async () => {
    const next = !online;
    setOnline(next);
    try {
      await apiFetch("/driver/status", { method: "POST", body: JSON.stringify({ is_online: next }) }, token);
    } catch {}
  };

  const accept = async (rideId: string) => {
    try {
      const r = await apiFetch<Ride>(`/rides/${rideId}/accept`, { method: "POST" }, token);
      setActiveRide(r);
    } catch {}
  };

  const startRide = async () => {
    if (!activeRide) return;
    try {
      const r = await apiFetch<Ride>(`/rides/${activeRide.id}/start`, { method: "POST" }, token);
      setActiveRide(r);
    } catch {}
  };

  const completeRide = async () => {
    if (!activeRide) return;
    try {
      const r = await apiFetch<Ride>(`/rides/${activeRide.id}/complete`, { method: "POST" }, token);
      setActiveRide(null);
      loadAvailable();
    } catch {}
  };

  return (
    <View style={styles.root} testID="driver-home">
      <MapCanvas
        region={{ latitude: DEFAULT_PICKUP.lat, longitude: DEFAULT_PICKUP.lng, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
        markers={activeRide ? [
          { id: "p", type: "pickup", coordinate: { latitude: activeRide.pickup.lat, longitude: activeRide.pickup.lng } },
          { id: "d", type: "dropoff", coordinate: { latitude: activeRide.dropoff.lat, longitude: activeRide.dropoff.lng } },
        ] : []}
      />

      {/* Online toggle */}
      <View style={[styles.topBar, { top: insets.top + theme.spacing.md }]}>
        <Pressable
          testID="online-toggle"
          onPress={toggleOnline}
          style={[styles.goBtn, online && styles.goBtnOnline]}
        >
          <Icon name={online ? "signal-variant" : "power"} size={20} color={online ? "#fff" : theme.color.onSurface} />
          <Text style={[styles.goText, online && { color: "#fff" }]}>{online ? "En ligne" : "Hors ligne"}</Text>
        </Pressable>
      </View>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
        <View style={styles.handle} />
        {activeRide ? (
          <ScrollView>
            <Text style={styles.sheetTitle}>
              {activeRide.status === "accepted" ? "En route vers le passager" : "Course en cours"}
            </Text>
            <View style={styles.passCard}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{activeRide.passenger_name[0]}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.passName}>{activeRide.passenger_name}</Text>
                <Text style={styles.passMeta}>{activeRide.vehicle_type.toUpperCase()}</Text>
              </View>
              <Text style={styles.passPrice}>{activeRide.price.toFixed(2)} €</Text>
            </View>

            <View style={styles.routeBox}>
              <View style={styles.routeRow}>
                <View style={[styles.dot, { backgroundColor: theme.color.success }]} />
                <Text style={styles.routeText} numberOfLines={1}>{activeRide.pickup.address}</Text>
              </View>
              <View style={styles.line} />
              <View style={styles.routeRow}>
                <Icon name="map-marker" size={14} color={theme.color.error} />
                <Text style={styles.routeText} numberOfLines={1}>{activeRide.dropoff.address}</Text>
              </View>
            </View>

            {activeRide.status === "accepted" && (
              <Pressable testID="start-ride" onPress={startRide} style={styles.primary}>
                <Text style={styles.primaryText}>Démarrer la course</Text>
              </Pressable>
            )}
            {activeRide.status === "in_progress" && (
              <Pressable testID="complete-ride" onPress={completeRide} style={[styles.primary, { backgroundColor: theme.color.success }]}>
                <Text style={styles.primaryText}>Terminer la course</Text>
              </Pressable>
            )}
          </ScrollView>
        ) : !online ? (
          <View style={styles.offline}>
            <Icon name="wifi-off" size={40} color={theme.color.onSurfaceTertiary} />
            <Text style={styles.offlineTitle}>Vous êtes hors ligne</Text>
            <Text style={styles.offlineText}>Passez en ligne pour recevoir des demandes de course</Text>
          </View>
        ) : (
          <ScrollView
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAvailable(); }} />}
          >
            <Text style={styles.sheetTitle}>Demandes disponibles ({rides.length})</Text>
            {loading && rides.length === 0 ? (
              <ActivityIndicator style={{ marginVertical: 40 }} color={theme.color.onSurface} />
            ) : rides.length === 0 ? (
              <View style={styles.empty}>
                <ActivityIndicator color={theme.color.onSurface} />
                <Text style={styles.emptyText}>En attente de courses…</Text>
              </View>
            ) : (
              rides.map((r) => (
                <View key={r.id} style={styles.request} testID={`request-${r.id}`}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={styles.reqType}>{r.vehicle_type.toUpperCase()}</Text>
                    <Text style={styles.reqPrice}>{r.price.toFixed(2)} €</Text>
                  </View>
                  <Text style={styles.reqAddr} numberOfLines={1}>{r.pickup.address}</Text>
                  <Text style={styles.reqAddrSmall} numberOfLines={1}>→ {r.dropoff.address}</Text>
                  <View style={{ flexDirection: "row", gap: theme.spacing.md, marginTop: theme.spacing.sm }}>
                    <Text style={styles.reqMeta}>{r.distance_km.toFixed(1)} km</Text>
                    <Text style={styles.reqMeta}>•</Text>
                    <Text style={styles.reqMeta}>{r.duration_min} min</Text>
                  </View>
                  <Pressable
                    testID={`accept-${r.id}`}
                    onPress={() => accept(r.id)}
                    style={styles.acceptBtn}
                  >
                    <Text style={styles.acceptText}>Accepter</Text>
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  topBar: { position: "absolute", left: theme.spacing.lg, right: theme.spacing.lg, alignItems: "flex-start" },
  goBtn: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surface, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderRadius: theme.radius.pill, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  goBtnOnline: { backgroundColor: theme.color.success },
  goText: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, top: "45%", backgroundColor: theme.color.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: theme.color.borderStrong, marginBottom: theme.spacing.md },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: theme.color.onSurface, marginBottom: theme.spacing.lg },
  offline: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.xl },
  offlineTitle: { fontSize: 18, fontWeight: "700", color: theme.color.onSurface },
  offlineText: { fontSize: 14, color: theme.color.onSurfaceSecondary, textAlign: "center" },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: theme.spacing.md },
  emptyText: { fontSize: 14, color: theme.color.onSurfaceSecondary },
  passCard: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.lg },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  passName: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  passMeta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2, fontWeight: "600" },
  passPrice: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  routeBox: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.lg },
  routeRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  routeText: { flex: 1, fontSize: 14, color: theme.color.onSurface, fontWeight: "500" },
  line: { width: 1, height: 12, backgroundColor: theme.color.borderStrong, marginLeft: 4, marginVertical: 6 },
  primary: { backgroundColor: theme.color.brand, height: 56, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.md },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  request: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.md },
  reqType: { fontSize: 11, fontWeight: "800", color: theme.color.onSurfaceSecondary, letterSpacing: 0.5 },
  reqPrice: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  reqAddr: { fontSize: 15, fontWeight: "600", color: theme.color.onSurface, marginTop: theme.spacing.sm },
  reqAddrSmall: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 4 },
  reqMeta: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontWeight: "600" },
  acceptBtn: { backgroundColor: theme.color.brand, height: 44, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.md },
  acceptText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});

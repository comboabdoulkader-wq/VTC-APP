import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import MapCanvas, { MapMarker } from "@/src/components/MapCanvas";
import { apiFetch, useAuth } from "@/src/context/auth";

type Ride = any;

const STATUS: Record<string, string> = {
  requested: "Recherche d'un chauffeur…",
  accepted: "Chauffeur en route",
  in_progress: "Course en cours",
  completed: "Course terminée",
  cancelled: "Course annulée",
};

export default function RideDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(5);
  const [submittingRate, setSubmittingRate] = useState(false);
  const [showRating, setShowRating] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<Ride>(`/rides/${id}`, {}, token);
      setRide(r);
      if (r.status === "completed" && !r.rating) setShowRating(true);
    } catch {}
    finally { setLoading(false); }
  }, [id, token]);

  useEffect(() => { load(); }, [load]);

  // Poll every 4s
  useEffect(() => {
    if (!ride) return;
    if (["completed", "cancelled"].includes(ride.status)) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [ride, load]);

  const cancel = async () => {
    try {
      await apiFetch(`/rides/${id}/cancel`, { method: "POST" }, token);
      router.replace("/(passenger)");
    } catch {}
  };

  const submitRating = async () => {
    setSubmittingRate(true);
    try {
      await apiFetch(`/rides/${id}/rate`, {
        method: "POST",
        body: JSON.stringify({ rating, tip: 0 }),
      }, token);
      router.replace("/(passenger)/rides");
    } catch {} finally { setSubmittingRate(false); }
  };

  if (loading || !ride) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.color.onSurface} />
      </View>
    );
  }

  const markers: MapMarker[] = [
    { id: "p", type: "pickup", coordinate: { latitude: ride.pickup.lat, longitude: ride.pickup.lng } },
    { id: "d", type: "dropoff", coordinate: { latitude: ride.dropoff.lat, longitude: ride.dropoff.lng } },
  ];

  const canCancel = ["requested", "accepted"].includes(ride.status);

  return (
    <View style={styles.root} testID="ride-detail">
      <MapCanvas
        region={{ latitude: (ride.pickup.lat + ride.dropoff.lat) / 2, longitude: (ride.pickup.lng + ride.dropoff.lng) / 2, latitudeDelta: 0.15, longitudeDelta: 0.15 }}
        markers={markers}
        polyline={[
          { latitude: ride.pickup.lat, longitude: ride.pickup.lng },
          { latitude: ride.dropoff.lat, longitude: ride.dropoff.lng },
        ]}
      />

      <Pressable
        testID="ride-back-button"
        onPress={() => router.replace("/(passenger)")}
        style={[styles.back, { top: insets.top + theme.spacing.md }]}
        hitSlop={12}
      >
        <Icon name="chevron-left" size={26} color={theme.color.onSurface} />
      </Pressable>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
        <View style={styles.handle} />
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.status}>{STATUS[ride.status] || ride.status}</Text>

          {ride.driver_name ? (
            <View style={styles.driverCard}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{ride.driver_name[0]}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.driverName}>{ride.driver_name}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Icon name="star" size={14} color={theme.color.star} />
                  <Text style={styles.driverRating}>{(ride.driver_rating || 5).toFixed(1)}</Text>
                </View>
              </View>
              <View style={styles.plate}>
                <Text style={styles.plateModel}>{ride.driver_vehicle}</Text>
                <Text style={styles.plateNum}>{ride.driver_plate}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.waitingCard}>
              <ActivityIndicator color={theme.color.onSurface} />
              <Text style={styles.waitingText}>Nous recherchons un chauffeur près de vous…</Text>
            </View>
          )}

          <View style={styles.routeBox}>
            <View style={styles.routeRow}>
              <View style={[styles.dot, { backgroundColor: theme.color.success }]} />
              <Text style={styles.routeText} numberOfLines={1}>{ride.pickup.address}</Text>
            </View>
            <View style={styles.line} />
            <View style={styles.routeRow}>
              <Icon name="map-marker" size={14} color={theme.color.error} />
              <Text style={styles.routeText} numberOfLines={1}>{ride.dropoff.address}</Text>
            </View>
          </View>

          <View style={styles.priceBox}>
            <Text style={styles.priceLabel}>Prix estimé</Text>
            <Text style={styles.priceValue}>{ride.price.toFixed(2)} €</Text>
          </View>

          {showRating && ride.status === "completed" && !ride.rating && (
            <View style={styles.rateBox} testID="rating-box">
              <Text style={styles.rateTitle}>Notez votre chauffeur</Text>
              <View style={styles.stars}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} testID={`star-${n}`} onPress={() => setRating(n)} hitSlop={6}>
                    <Icon name={n <= rating ? "star" : "star-outline"} size={40} color={theme.color.star} />
                  </Pressable>
                ))}
              </View>
              <Pressable
                testID="submit-rating"
                onPress={submitRating}
                disabled={submittingRate}
                style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }, submittingRate && { opacity: 0.7 }]}
              >
                {submittingRate ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Envoyer</Text>}
              </Pressable>
            </View>
          )}

          {canCancel && (
            <Pressable testID="cancel-ride" onPress={cancel} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Annuler la course</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface },
  back: { position: "absolute", left: theme.spacing.lg, width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: theme.color.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, maxHeight: "70%" },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: theme.color.borderStrong, marginBottom: theme.spacing.md },
  status: { fontSize: 20, fontWeight: "800", color: theme.color.onSurface, marginBottom: theme.spacing.lg },
  driverCard: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.lg },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  driverName: { fontSize: 16, fontWeight: "700", color: theme.color.onSurface },
  driverRating: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: "600" },
  plate: { alignItems: "flex-end" },
  plateModel: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: "600" },
  plateNum: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  waitingCard: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.lg },
  waitingText: { flex: 1, fontSize: 14, color: theme.color.onSurfaceSecondary, fontWeight: "500" },
  routeBox: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.lg },
  routeRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  routeText: { flex: 1, fontSize: 14, color: theme.color.onSurface, fontWeight: "500" },
  line: { width: 1, height: 12, backgroundColor: theme.color.borderStrong, marginLeft: 4, marginVertical: 6 },
  priceBox: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: theme.spacing.lg },
  priceLabel: { fontSize: 14, color: theme.color.onSurfaceSecondary },
  priceValue: { fontSize: 22, fontWeight: "800", color: theme.color.onSurface },
  rateBox: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.lg, alignItems: "center" },
  rateTitle: { fontSize: 16, fontWeight: "700", marginBottom: theme.spacing.md, color: theme.color.onSurface },
  stars: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  primary: { backgroundColor: theme.color.brand, height: 48, paddingHorizontal: theme.spacing.xl, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  cancelBtn: { height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  cancelText: { color: theme.color.error, fontWeight: "700", fontSize: 15 },
});

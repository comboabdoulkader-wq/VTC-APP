import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList, TextInput } from "react-native";
import BottomSheet, { BottomSheetView, BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import MapCanvas, { MapMarker } from "@/src/components/MapCanvas";
import { POPULAR_PLACES, DEFAULT_PICKUP, Place } from "@/src/data/places";
import { apiFetch, useAuth } from "@/src/context/auth";

type Estimate = {
  vehicle_type: "standard" | "premium" | "van";
  label: string;
  price: number;
  distance_km: number;
  duration_min: number;
  eta_min: number;
};

export default function PassengerHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const sheetRef = useRef<BottomSheet>(null);
  const [pickup] = useState<Place>(DEFAULT_PICKUP);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [query, setQuery] = useState("");
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [selected, setSelected] = useState<Estimate | null>(null);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [activeRideId, setActiveRideId] = useState<string | null>(null);

  const snapPoints = useMemo(() => ["28%", "60%", "90%"], []);

  // Check active ride
  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch<any>("/rides/active", {}, token);
        if (alive && r?.id) setActiveRideId(r.id);
        else if (alive) setActiveRideId(null);
      } catch {}
    })();
    return () => { alive = false; };
  }, [token]));

  const markers: MapMarker[] = useMemo(() => {
    const arr: MapMarker[] = [{ id: "p", type: "pickup", coordinate: { latitude: pickup.lat, longitude: pickup.lng } }];
    if (dropoff) arr.push({ id: "d", type: "dropoff", coordinate: { latitude: dropoff.lat, longitude: dropoff.lng } });
    return arr;
  }, [pickup, dropoff]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return POPULAR_PLACES;
    return POPULAR_PLACES.filter((p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q));
  }, [query]);

  const chooseDropoff = async (p: Place) => {
    setDropoff(p);
    setQuery("");
    setEstimates([]);
    setSelected(null);
    setLoadingEstimate(true);
    sheetRef.current?.snapToIndex(1);
    try {
      const list = await apiFetch<Estimate[]>("/rides/estimate", {
        method: "POST",
        body: JSON.stringify({
          pickup: { lat: pickup.lat, lng: pickup.lng, address: pickup.address },
          dropoff: { lat: p.lat, lng: p.lng, address: p.address },
        }),
      }, token);
      setEstimates(list);
      setSelected(list[0]);
    } catch (e) {
      // ignore
    } finally { setLoadingEstimate(false); }
  };

  const confirmRide = async () => {
    if (!dropoff || !selected) return;
    setConfirming(true);
    try {
      const ride = await apiFetch<any>("/rides", {
        method: "POST",
        body: JSON.stringify({
          pickup: { lat: pickup.lat, lng: pickup.lng, address: pickup.address },
          dropoff: { lat: dropoff.lat, lng: dropoff.lng, address: dropoff.address },
          vehicle_type: selected.vehicle_type,
          price: selected.price,
          distance_km: selected.distance_km,
          duration_min: selected.duration_min,
        }),
      }, token);
      router.push(`/(passenger)/ride/${ride.id}`);
    } catch (e) {
    } finally { setConfirming(false); }
  };

  return (
    <View style={styles.root} testID="passenger-home">
      <MapCanvas
        region={{ latitude: pickup.lat, longitude: pickup.lng, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
        markers={markers}
      />

      {/* Top hint */}
      <View style={[styles.topBar, { top: insets.top + theme.spacing.md }]}>
        <View style={styles.locChip}>
          <Icon name="crosshairs-gps" size={16} color={theme.color.success} />
          <Text style={styles.locChipText} numberOfLines={1}>{pickup.name}</Text>
        </View>
      </View>

      {activeRideId && (
        <Pressable
          testID="active-ride-banner"
          onPress={() => router.push(`/(passenger)/ride/${activeRideId}`)}
          style={[styles.activeBanner, { top: insets.top + 60 }]}
        >
          <Icon name="car-clock" size={20} color="#fff" />
          <Text style={styles.activeBannerText}>Course en cours – Voir</Text>
          <Icon name="chevron-right" size={20} color="#fff" />
        </Pressable>
      )}

      <BottomSheet
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        keyboardBehavior="interactive"
        handleIndicatorStyle={{ backgroundColor: theme.color.borderStrong }}
        backgroundStyle={{ backgroundColor: theme.color.surface }}
      >
        <BottomSheetView style={{ flex: 1, paddingHorizontal: theme.spacing.xl, paddingBottom: insets.bottom + theme.spacing.lg }}>
          {!dropoff ? (
            <>
              <Text style={styles.sheetTitle}>Où allez-vous ?</Text>
              <View style={styles.searchWrap}>
                <Icon name="magnify" size={20} color={theme.color.onSurfaceTertiary} />
                <BottomSheetTextInput
                  testID="destination-search"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Rechercher une adresse"
                  placeholderTextColor={theme.color.onSurfaceTertiary}
                  style={styles.searchInput}
                  onFocus={() => sheetRef.current?.snapToIndex(2)}
                />
              </View>
              <FlatList
                data={results}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable
                    testID={`place-${item.id}`}
                    style={styles.placeRow}
                    onPress={() => chooseDropoff(item)}
                  >
                    <View style={styles.placeIcon}>
                      <Icon name="map-marker-outline" size={22} color={theme.color.onSurface} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.placeName}>{item.name}</Text>
                      <Text style={styles.placeAddr} numberOfLines={1}>{item.address}</Text>
                    </View>
                  </Pressable>
                )}
              />
            </>
          ) : (
            <>
              <View style={styles.trip}>
                <Icon name="dots-vertical" size={22} color={theme.color.onSurfaceTertiary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.tripLabel}>Départ</Text>
                  <Text style={styles.tripAddr} numberOfLines={1}>{pickup.name}</Text>
                  <View style={styles.tripDivider} />
                  <Text style={styles.tripLabel}>Arrivée</Text>
                  <Text style={styles.tripAddr} numberOfLines={1}>{dropoff.name}</Text>
                </View>
                <Pressable testID="reset-dropoff" onPress={() => { setDropoff(null); setEstimates([]); setSelected(null); }}>
                  <Icon name="close" size={22} color={theme.color.onSurfaceSecondary} />
                </Pressable>
              </View>

              <Text style={styles.sectionTitle}>Choisissez votre course</Text>
              {loadingEstimate ? (
                <ActivityIndicator style={{ marginVertical: 40 }} color={theme.color.onSurface} />
              ) : (
                <View style={{ gap: theme.spacing.sm }}>
                  {estimates.map((e) => {
                    const active = selected?.vehicle_type === e.vehicle_type;
                    return (
                      <Pressable
                        key={e.vehicle_type}
                        testID={`vehicle-${e.vehicle_type}`}
                        onPress={() => setSelected(e)}
                        style={[styles.vehicleRow, active && styles.vehicleRowActive]}
                      >
                        <View style={styles.vehicleIcon}>
                          <Icon
                            name={e.vehicle_type === "van" ? "van-passenger" : e.vehicle_type === "premium" ? "car-sports" : "car"}
                            size={26}
                            color={theme.color.onSurface}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.vehicleName}>{e.label}</Text>
                          <Text style={styles.vehicleMeta}>{e.eta_min} min • {e.duration_min} min de trajet</Text>
                        </View>
                        <Text style={styles.vehiclePrice}>{e.price.toFixed(2)} €</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <Pressable
                testID="confirm-ride-button"
                disabled={!selected || confirming}
                onPress={confirmRide}
                style={({ pressed }) => [styles.confirmBtn, (!selected || confirming) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
              >
                {confirming ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.confirmText}>Confirmer {selected ? `• ${selected.price.toFixed(2)} €` : ""}</Text>
                )}
              </Pressable>
            </>
          )}
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  topBar: { position: "absolute", left: theme.spacing.lg, right: theme.spacing.lg, alignItems: "flex-start" },
  locChip: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surface, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, borderRadius: theme.radius.pill, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3, maxWidth: "80%" },
  locChipText: { color: theme.color.onSurface, fontWeight: "600", fontSize: 13 },
  activeBanner: { position: "absolute", left: theme.spacing.lg, right: theme.spacing.lg, backgroundColor: theme.color.success, flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderRadius: theme.radius.md },
  activeBannerText: { color: "#fff", fontWeight: "700", flex: 1 },
  sheetTitle: { fontSize: 22, fontWeight: "800", color: theme.color.onSurface, marginTop: theme.spacing.sm, marginBottom: theme.spacing.md },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 52, marginBottom: theme.spacing.md },
  searchInput: { flex: 1, fontSize: 16, color: theme.color.onSurface, height: "100%" },
  placeRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  placeIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  placeName: { fontSize: 15, fontWeight: "600", color: theme.color.onSurface },
  placeAddr: { fontSize: 13, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  trip: { flexDirection: "row", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.md, marginTop: theme.spacing.sm, alignItems: "center" },
  tripLabel: { fontSize: 11, color: theme.color.onSurfaceTertiary, fontWeight: "600", textTransform: "uppercase" },
  tripAddr: { fontSize: 15, color: theme.color.onSurface, fontWeight: "600", marginTop: 2 },
  tripDivider: { height: 1, backgroundColor: theme.color.border, marginVertical: theme.spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface, marginTop: theme.spacing.xl, marginBottom: theme.spacing.md },
  vehicleRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, padding: theme.spacing.md, borderRadius: theme.radius.md, borderWidth: 2, borderColor: "transparent", backgroundColor: theme.color.surfaceSecondary },
  vehicleRowActive: { borderColor: theme.color.onSurface, backgroundColor: theme.color.surface },
  vehicleIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center" },
  vehicleName: { fontSize: 16, fontWeight: "700", color: theme.color.onSurface },
  vehicleMeta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  vehiclePrice: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  confirmBtn: { backgroundColor: theme.color.brand, height: 56, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.lg },
  confirmText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 16 },
});

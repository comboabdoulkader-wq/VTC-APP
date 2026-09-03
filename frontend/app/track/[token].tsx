import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import MapCanvas, { MapMarker } from "@/src/components/MapCanvas";
import { apiFetch } from "@/src/context/auth";

const STATUS: Record<string, string> = { requested: "Recherche d'un chauffeur…", accepted: "Chauffeur en route", in_progress: "Trajet en cours", completed: "Arrivé à destination ✅", cancelled: "Course annulée" };

/** Public live-tracking page shared with a relative (no login required). */
export default function PublicTrack() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await apiFetch<any>(`/public/track/${token}`)); setError(null); } catch (e: any) { setError(e.message); }
  }, [token]);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  if (error) return <View style={styles.center}><Icon name="link-off" size={48} color={theme.color.onSurfaceTertiary} /><Text style={styles.title}>Lien de suivi invalide</Text></View>;
  if (!data) return <View style={styles.center}><ActivityIndicator color={theme.color.onSurface} /></View>;

  const markers: MapMarker[] = [
    { id: "p", type: "pickup", coordinate: { latitude: data.pickup.lat, longitude: data.pickup.lng } },
    { id: "d", type: "dropoff", coordinate: { latitude: data.dropoff.lat, longitude: data.dropoff.lng } },
  ];
  if (data.driver_location && ["accepted", "in_progress"].includes(data.status)) markers.push({ id: "drv", type: "driver", coordinate: { latitude: data.driver_location.lat, longitude: data.driver_location.lng } });

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.surface }} testID="public-track">
      <MapCanvas region={{ latitude: (data.pickup.lat + data.dropoff.lat) / 2, longitude: (data.pickup.lng + data.dropoff.lng) / 2, latitudeDelta: 0.15, longitudeDelta: 0.15 }} markers={markers}
        polyline={[{ latitude: data.pickup.lat, longitude: data.pickup.lng }, { latitude: data.dropoff.lat, longitude: data.dropoff.lng }]} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
        <Text style={styles.small}>Suivi en direct du trajet de {data.passenger_name}</Text>
        <Text style={styles.title}>{STATUS[data.status] || data.status}{data.driver_eta_min != null && data.status === "accepted" ? ` · ${data.driver_eta_min} min` : ""}</Text>
        {data.driver_name && <Text style={styles.line}>🚗 {data.driver_name} · {data.driver_vehicle} · {data.driver_plate} · ★ {(data.driver_rating || 5).toFixed(1)}</Text>}
        <Text style={styles.line}>● {data.pickup.address}</Text>
        <Text style={styles.line}>▼ {data.dropoff.address}</Text>
        <Text style={styles.small}>Position mise à jour toutes les 5 secondes</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing.md, backgroundColor: theme.color.surface },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: theme.color.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: theme.spacing.xl, gap: 6 },
  title: { fontSize: 20, fontWeight: "800", color: theme.color.onSurface },
  line: { fontSize: 14, color: theme.color.onSurface },
  small: { fontSize: 12, color: theme.color.onSurfaceTertiary },
});

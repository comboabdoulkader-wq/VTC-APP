import { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import MapCanvas, { MapMarker } from "@/src/components/MapCanvas";
import { money, fmtDateTime } from "@/src/utils/format";

type Ride = any;

function useCountdown(expiresAt?: string | null, onExpire?: () => void) {
  const [left, setLeft] = useState(0);
  const [total, setTotal] = useState(0);
  const firedRef = useRef(false);
  useEffect(() => {
    if (!expiresAt) return;
    const end = new Date(expiresAt).getTime();
    const start = Date.now();
    const initial = Math.max(0, Math.round((end - start) / 1000));
    setTotal(initial > 0 ? initial : 1);
    firedRef.current = false;
    const tick = () => {
      const rem = Math.max(0, Math.round((end - Date.now()) / 1000));
      setLeft(rem);
      if (rem <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpire?.();
      }
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);
  return { left, total };
}

export default function IncomingRideScreen({
  ride,
  driverCoords,
  onAccept,
  onDecline,
  onExpire,
}: {
  ride: Ride;
  driverCoords?: { lat: number; lng: number } | null;
  onAccept: () => void;
  onDecline: () => void;
  onExpire: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { left, total } = useCountdown(ride.offer_expires_at, onExpire);
  const [busy, setBusy] = useState(false);

  // Repeating alarm haptics while the offer is live
  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    const pulse = async () => {
      if (cancelled) return;
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } catch {}
    };
    pulse();
    const t = setInterval(pulse, 1500);
    return () => { cancelled = true; clearInterval(t); };
  }, [ride.id]);

  const pct = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  const urgent = left <= 5;

  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [
      { id: "p", type: "pickup", coordinate: { latitude: ride.pickup.lat, longitude: ride.pickup.lng } },
      { id: "d", type: "dropoff", coordinate: { latitude: ride.dropoff.lat, longitude: ride.dropoff.lng } },
    ];
    if (driverCoords) m.push({ id: "me", type: "driver", coordinate: { latitude: driverCoords.lat, longitude: driverCoords.lng } });
    return m;
  }, [ride.id, driverCoords?.lat, driverCoords?.lng]);

  const center = { latitude: ride.pickup.lat, longitude: ride.pickup.lng };

  const doAccept = () => { if (busy) return; setBusy(true); Haptics.impactAsync?.(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); onAccept(); };
  const doDecline = () => { if (busy) return; setBusy(true); onDecline(); };

  return (
    <View style={styles.overlay} testID="incoming-ride-screen">
      <View style={styles.mapWrap}>
        <MapCanvas region={{ ...center, latitudeDelta: 0.05, longitudeDelta: 0.05 }} markers={markers} />
        <View style={[styles.topBanner, { paddingTop: insets.top + theme.spacing.md }]}>
          <View style={styles.pill}>
            <Icon name="car-connected" size={18} color="#fff" />
            <Text style={styles.pillText}>Nouvelle course</Text>
          </View>
          <View style={[styles.timer, urgent && styles.timerUrgent]} testID="offer-countdown">
            <Text style={styles.timerNum}>{left}</Text>
            <Text style={styles.timerUnit}>s</Text>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct * 100}%` }, urgent && { backgroundColor: theme.color.error }]} />
        </View>
      </View>

      <View style={[styles.card, { paddingBottom: insets.bottom + theme.spacing.md }]}>
        <View style={styles.headerRow}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(ride.passenger_label || ride.passenger_name || "?")[0]}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{ride.passenger_label || ride.passenger_name}</Text>
            <Text style={styles.meta}>
              {ride.vehicle_type?.toUpperCase()} · {ride.distance_km?.toFixed?.(1)} km · {ride.duration_min} min
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.price}>{money(ride.price)}</Text>
            <Text style={styles.payMeta}>{ride.payment_method === "card" ? "💳 Carte" : "💵 Espèces"}</Text>
          </View>
        </View>

        <View style={styles.tags}>
          {ride.scheduled_at ? <Text style={[styles.tag, styles.tagSched]}>📅 {fmtDateTime(ride.scheduled_at)}</Text> : <Text style={[styles.tag, styles.tagNow]}>⚡ Immédiat</Text>}
          {ride.surcharge_enabled ? <Text style={[styles.tag, styles.tagBonus]}>+{money(ride.surcharge_amount)} rallonge</Text> : null}
          {ride.service_type && ride.service_type !== "private" ? <Text style={styles.tag}>{ride.service_label}</Text> : null}
          <Text style={styles.tag}>👥 {(ride.passengers || 1) + (ride.children || 0)} · 🧳 {ride.luggage || 0}</Text>
          {(ride.stops || []).length ? <Text style={styles.tag}>🛑 {(ride.stops || []).length} arrêt{(ride.stops || []).length > 1 ? "s" : ""}</Text> : null}
        </View>

        <View style={styles.routeBox}>
          <View style={styles.routeRow}><View style={[styles.dot, { backgroundColor: theme.color.success }]} /><Text style={styles.routeText} numberOfLines={1}>{ride.pickup.address}</Text></View>
          <View style={styles.routeLine} />
          <View style={styles.routeRow}><Icon name="map-marker" size={14} color={theme.color.error} /><Text style={styles.routeText} numberOfLines={1}>{ride.dropoff.address}</Text></View>
        </View>

        <View style={styles.actions}>
          <Pressable testID="offer-decline" onPress={doDecline} disabled={busy} style={styles.declineBtn}>
            <Icon name="close" size={20} color={theme.color.onSurfaceSecondary} />
            <Text style={styles.declineText}>Refuser</Text>
          </Pressable>
          <Pressable testID="offer-accept" onPress={doAccept} disabled={busy} style={styles.acceptBtn}>
            <Icon name="check" size={22} color="#fff" />
            <Text style={styles.acceptText}>Accepter · {left}s</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: theme.color.surface, zIndex: 100, elevation: 100 },
  mapWrap: { flex: 1 },
  topBanner: { position: "absolute", left: theme.spacing.lg, right: theme.spacing.lg, top: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  pill: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: theme.color.brand, paddingHorizontal: theme.spacing.lg, height: 44, borderRadius: theme.radius.pill, boxShadow: "0 2px 8px rgba(0,0,0,0.2)" },
  pillText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  timer: { width: 64, height: 64, borderRadius: 32, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center", flexDirection: "row", boxShadow: "0 2px 10px rgba(0,0,0,0.25)" },
  timerUrgent: { backgroundColor: theme.color.error },
  timerNum: { color: "#fff", fontSize: 26, fontWeight: "900" },
  timerUnit: { color: "#fff", fontSize: 13, fontWeight: "800", marginTop: 6, marginLeft: 1 },
  progressTrack: { position: "absolute", bottom: 0, left: 0, right: 0, height: 6, backgroundColor: "rgba(0,0,0,0.08)" },
  progressFill: { height: 6, backgroundColor: theme.color.brand },
  card: { backgroundColor: theme.color.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.lg, gap: theme.spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  name: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  meta: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 2, fontWeight: "600" },
  price: { fontSize: 22, fontWeight: "900", color: theme.color.onSurface },
  payMeta: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontWeight: "700", marginTop: 2 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { fontSize: 11, fontWeight: "700", color: theme.color.onSurfaceSecondary, backgroundColor: theme.color.surfaceSecondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill },
  tagSched: { color: theme.color.warning },
  tagNow: { color: theme.color.brand },
  tagBonus: { color: theme.color.success, backgroundColor: "#EAF6EE" },
  routeBox: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md },
  routeRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  routeText: { flex: 1, fontSize: 14, color: theme.color.onSurface, fontWeight: "500" },
  routeLine: { width: 1, height: 12, backgroundColor: theme.color.borderStrong, marginLeft: 4, marginVertical: 6 },
  actions: { flexDirection: "row", gap: theme.spacing.md, marginTop: theme.spacing.xs },
  declineBtn: { flex: 1, flexDirection: "row", gap: theme.spacing.sm, height: 58, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: theme.color.borderStrong },
  declineText: { fontWeight: "800", color: theme.color.onSurfaceSecondary, fontSize: 15 },
  acceptBtn: { flex: 2, flexDirection: "row", gap: theme.spacing.sm, backgroundColor: theme.color.success, height: 58, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  acceptText: { color: "#fff", fontWeight: "900", fontSize: 17 },
});

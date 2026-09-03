import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, RefreshControl, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import MapCanvas, { MapMarker, LatLng } from "@/src/components/MapCanvas";
import { getNavApp, setNavApp, openNavigation, NavApp } from "@/src/utils/files";
import RideChat, { ChatButton } from "@/src/components/RideChat";
import { apiFetch, useAuth } from "@/src/context/auth";
import { DEFAULT_PICKUP } from "@/src/data/places";
import { useDriverLocation } from "@/src/hooks/useDriverLocation";
import { money, fmtDateTime } from "@/src/utils/format";

type Ride = any;

function RideTags({ r }: { r: Ride }) {
  return (
    <View style={styles.tags}>
      {r.scheduled_at ? <Text style={[styles.tag, styles.tagSched]}>📅 {fmtDateTime(r.scheduled_at)}</Text> : <Text style={styles.tag}>⚡ Immédiat</Text>}
      {r.surcharge_enabled ? <Text style={[styles.tag, styles.tagBonus]}>+{money(r.surcharge_amount)} rallonge</Text> : null}
      {r.passenger_label ? <Text style={styles.tag}>👤 {r.passenger_label}</Text> : null}
      {r.service_type && r.service_type !== "private" ? <Text style={styles.tag}>{r.service_label}{r.hours ? ` ${r.hours} h` : ""}</Text> : null}
      <Text style={styles.tag}>👥 {(r.passengers || 1) + (r.children || 0)} · 🧳 {r.luggage || 0}{r.child_seats ? ` · 🪑 ${r.child_seats}` : ""}</Text>
      {r.flight?.number ? <Text style={[styles.tag, r.flight.arrival_delay_min > 0 && styles.tagBonus]}>✈️ {r.flight.number}{r.flight.arrival_delay_min > 0 ? ` retard +${r.flight.arrival_delay_min} min` : r.flight.status ? ` ${r.flight.status}` : ""}</Text> : null}
      {r.fixed_price ? <Text style={styles.tag}>🔒 Prix fixe</Text> : null}
      <Text style={styles.tag}>{r.payment_method === "card" ? "💳 Carte" : "💵 Espèces"}</Text>
      {r.assigned_by_name ? <Text style={styles.tag}>🧭 Affectée par {r.assigned_by_name}</Text> : null}
    </View>
  );
}

export default function DriverHome() {
  const insets = useSafeAreaInsets();
  const { token, user, refresh } = useAuth();
  const router = useRouter();
  const [online, setOnline] = useState(false);
  const [route, setRoute] = useState<LatLng[] | null>(null);
  const [routeInfo, setRouteInfo] = useState<{ distance_km: number | null; duration_min: number | null } | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [compliance, setCompliance] = useState<{ blocked: boolean; blocking: string[] } | null>(null);
  const blocked = compliance ? compliance.blocked : !!user?.docs_blocked;
  const [rides, setRides] = useState<Ride[]>([]);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [eta, setEta] = useState<number | null>(null);
  const [showPermCard, setShowPermCard] = useState(false);

  const onPing = useCallback((res: { eta_min?: number }) => { if (res.eta_min != null) setEta(res.eta_min); }, []);
  const loc = useDriverLocation(token, online, onPing);

  const loadActive = useCallback(async () => {
    try { setActiveRide(await apiFetch<Ride>("/rides/active", {}, token)); } catch { setActiveRide(null); }
  }, [token]);

  const loadAvailable = useCallback(async () => {
    if (!online) { setRides([]); return; }
    setLoading(true);
    try { setRides(await apiFetch<Ride[]>("/rides/available", {}, token)); } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [online, token]);

  useFocusEffect(useCallback(() => {
    loadActive(); loadAvailable();
    apiFetch<any>("/documents/mine", {}, token).then((c) => setCompliance({ blocked: c.blocked, blocking: c.blocking })).catch(() => {});
  }, [loadActive, loadAvailable, token]));

  useEffect(() => {
    const t = setInterval(() => { loadActive(); if (online && !activeRide) loadAvailable(); }, 5000);
    return () => clearInterval(t);
  }, [online, activeRide, loadAvailable, loadActive]);

  useEffect(() => { loadAvailable(); }, [online, loadAvailable]);

  // In-app travel plan: real driving route (OSRM) from driver position (or pickup) to the current target
  useEffect(() => {
    if (!activeRide) { setRoute(null); setRouteInfo(null); return; }
    const target = activeRide.status === "accepted" ? activeRide.pickup : activeRide.dropoff;
    const from = loc.coords || (activeRide.status === "accepted" ? null : activeRide.pickup);
    if (!from) { setRoute(null); return; }
    apiFetch<any>(`/geo/route?from_lat=${from.lat}&from_lng=${from.lng}&to_lat=${target.lat}&to_lng=${target.lng}`)
      .then((r) => { setRoute(r.coords); setRouteInfo({ distance_km: r.distance_km, duration_min: r.duration_min }); }).catch(() => setRoute(null));
  }, [activeRide?.id, activeRide?.status, loc.coords?.lat, loc.coords?.lng]);

  const navigateTo = async (target: { lat: number; lng: number; address: string }) => {
    let app = await getNavApp();
    if (!app) {
      Alert.alert("Application de navigation", "Choisissez votre GPS par défaut (modifiable dans Profil → Navigation)", [
        { text: "Waze", onPress: async () => { await setNavApp("waze"); openNavigation("waze", target.lat, target.lng, target.address); } },
        { text: "Google Maps", onPress: async () => { await setNavApp("gmaps"); openNavigation("gmaps", target.lat, target.lng, target.address); } },
      ]);
      return;
    }
    openNavigation(app as NavApp, target.lat, target.lng, target.address);
  };

  const toggleOnline = async () => {
    if (blocked) { refresh(); router.push("/(driver)/documents"); return; }
    const next = !online;
    if (next && loc.permission !== "granted" && !loc.isWeb) setShowPermCard(true);
    setOnline(next);
    try { await apiFetch("/driver/status", { method: "POST", body: JSON.stringify({ is_online: next, ...(loc.coords || {}) }) }, token); } catch {}
  };

  const enableGps = async () => { const ok = await loc.request(); if (ok) setShowPermCard(false); };

  const act = async (path: string, body?: any) => {
    try {
      const r = await apiFetch<Ride>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }, token);
      return r;
    } catch { return null; }
  };
  const decline = async (id: string) => { await act(`/rides/${id}/decline`); setRides((l) => l.filter((r) => r.id !== id)); };
  const accept = async (id: string) => { const r = await act(`/rides/${id}/accept`); if (r) { setActiveRide(r); setEta(null); } };
  const startRide = async () => { if (activeRide) { const r = await act(`/rides/${activeRide.id}/start`); if (r) setActiveRide(r); } };
  const completeRide = async () => { if (activeRide) { await act(`/rides/${activeRide.id}/complete`); setActiveRide(null); setEta(null); loadAvailable(); } };
  const imHere = async () => {
    if (!activeRide) return;
    await act("/driver/location", { lat: activeRide.pickup.lat, lng: activeRide.pickup.lng });
    const r = await act(`/rides/${activeRide.id}/arrived`);
    if (r) setActiveRide(r);
    setEta(0);
  };
  const stopArrive = async (i: number) => { if (activeRide) { const r = await act(`/rides/${activeRide.id}/stops/${i}/arrive`); if (r) setActiveRide(r); } };
  const stopDepart = async (i: number) => { if (activeRide) { const r = await act(`/rides/${activeRide.id}/stops/${i}/depart`); if (r) setActiveRide(r); } };

  const markers: MapMarker[] = [];
  if (loc.coords) markers.push({ id: "me", type: "driver", coordinate: { latitude: loc.coords.lat, longitude: loc.coords.lng } });
  if (activeRide) {
    markers.push({ id: "p", type: "pickup", coordinate: { latitude: activeRide.pickup.lat, longitude: activeRide.pickup.lng } });
    markers.push({ id: "d", type: "dropoff", coordinate: { latitude: activeRide.dropoff.lat, longitude: activeRide.dropoff.lng } });
  }
  const center = loc.coords ? { latitude: loc.coords.lat, longitude: loc.coords.lng } : { latitude: DEFAULT_PICKUP.lat, longitude: DEFAULT_PICKUP.lng };

  return (
    <View style={styles.root} testID="driver-home">
      <MapCanvas region={{ ...center, latitudeDelta: 0.08, longitudeDelta: 0.08 }} markers={markers} polyline={route || undefined} />

      <View style={[styles.topBar, { top: insets.top + theme.spacing.md }]}>
        <Pressable testID="online-toggle" onPress={toggleOnline} style={[styles.goBtn, online && styles.goBtnOnline]}>
          <Icon name={online ? "signal-variant" : "power"} size={20} color={online ? "#fff" : theme.color.onSurface} />
          <Text style={[styles.goText, online && { color: "#fff" }]}>{online ? "En ligne" : "Hors ligne"}</Text>
        </Pressable>
        <View style={[styles.gpsChip, loc.permission === "granted" && online && styles.gpsChipOn]} testID="gps-chip">
          <Icon name={loc.permission === "granted" ? "crosshairs-gps" : "crosshairs-off"} size={16} color={loc.permission === "granted" && online ? "#fff" : theme.color.onSurfaceSecondary} />
          <Text style={[styles.gpsText, loc.permission === "granted" && online && { color: "#fff" }]}>
            {loc.isWeb ? "GPS (mobile)" : loc.permission === "granted" ? (online ? "GPS live" : "GPS prêt") : "GPS off"}
          </Text>
        </View>
      </View>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
        <View style={styles.handle} />

        {blocked && (
          <Pressable testID="docs-blocked-banner" onPress={() => router.push("/(driver)/documents")} style={styles.blockedCard}>
            <Icon name="lock-alert" size={26} color={theme.color.error} />
            <View style={{ flex: 1 }}>
              <Text style={styles.blockedTitle}>Compte temporairement bloqué</Text>
              <Text style={styles.blockedText}>Votre compte est temporairement bloqué car un ou plusieurs documents obligatoires ont expiré ou manquent. Merci de les mettre à jour pour réactiver votre compte.</Text>
              {compliance?.blocking?.length ? <Text style={styles.blockedText}>À fournir : {compliance.blocking.join(", ")}</Text> : null}
              <Text style={[styles.blockedText, { fontWeight: "800", marginTop: 4 }]}>Ouvrir mes documents →</Text>
            </View>
          </Pressable>
        )}

        {showPermCard && loc.permission !== "granted" && (
          <View style={styles.permCard} testID="location-permission-card">
            <Icon name="map-marker-radius" size={28} color={theme.color.onSurface} />
            <View style={{ flex: 1 }}>
              <Text style={styles.permTitle}>Activer la localisation</Text>
              <Text style={styles.permText}>
                {loc.permission === "blocked"
                  ? "La localisation est bloquée. Autorisez-la dans les réglages pour que vos passagers vous suivent en direct."
                  : "Permet aux passagers de suivre votre arrivée minute par minute et déclenche l'alerte « chauffeur à 2 min »."}
              </Text>
              <View style={{ flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.sm }}>
                {loc.permission === "blocked" ? (
                  <Pressable testID="open-settings" onPress={loc.openSettings} style={styles.permBtn}><Text style={styles.permBtnText}>Ouvrir les réglages</Text></Pressable>
                ) : (
                  <Pressable testID="enable-gps" onPress={enableGps} style={styles.permBtn}><Text style={styles.permBtnText}>Autoriser</Text></Pressable>
                )}
                <Pressable testID="skip-gps" onPress={() => setShowPermCard(false)} style={styles.permGhost}><Text style={styles.permGhostText}>Plus tard</Text></Pressable>
              </View>
            </View>
          </View>
        )}

        {activeRide ? (
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.rowBetween}>
              <Text style={styles.sheetTitle}>{activeRide.status === "accepted" ? "En route vers le passager" : "Course en cours"}</Text>
              {eta != null && <View style={styles.etaPill}><Icon name="clock-fast" size={14} color="#fff" /><Text style={styles.etaText}>{eta <= 1 ? "Sur place" : `${eta} min`}</Text></View>}
            </View>
            <View style={styles.passCard}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{activeRide.passenger_name[0]}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.passName}>{activeRide.passenger_label || activeRide.passenger_name}</Text>
                <Text style={styles.passMeta}>{activeRide.passenger_label ? `Commandé par ${activeRide.passenger_name} · ` : ""}{activeRide.vehicle_type.toUpperCase()}</Text>
              </View>
              <Text style={styles.passPrice}>{money(activeRide.price)}</Text>
            </View>
            <RideTags r={activeRide} />

            <View style={styles.routeBox}>
              <View style={styles.routeRow}><View style={[styles.dot, { backgroundColor: theme.color.success }]} /><Text style={styles.routeText} numberOfLines={1}>{activeRide.pickup.address}</Text></View>
              <View style={styles.line} />
              <View style={styles.routeRow}><Icon name="map-marker" size={14} color={theme.color.error} /><Text style={styles.routeText} numberOfLines={1}>{activeRide.dropoff.address}</Text></View>
              {activeRide.notes ? <Text style={styles.notes}>📝 {activeRide.notes}</Text> : null}
            </View>

            {routeInfo?.distance_km != null && (
              <Text style={styles.routeInfo}>🛣️ Itinéraire : {routeInfo.distance_km} km · ≈ {routeInfo.duration_min} min</Text>
            )}
            <ChatButton rideId={activeRide.id} onPress={() => setChatOpen(true)} label={`Écrire à ${activeRide.passenger_label || activeRide.passenger_name}`} />
            <RideChat rideId={activeRide.id} visible={chatOpen} onClose={() => setChatOpen(false)} title={activeRide.passenger_label || activeRide.passenger_name} canSend />
            <Pressable testID="navigate-button" onPress={() => navigateTo(activeRide.status === "accepted" ? activeRide.pickup : activeRide.dropoff)} style={styles.navBtn}>
              <Icon name="navigation-variant" size={20} color="#fff" />
              <Text style={styles.navText}>{activeRide.status === "accepted" ? "Aller au client" : "Aller à destination"} · Waze / Google Maps</Text>
            </Pressable>
            {activeRide.status === "accepted" && (
              <>
                <Pressable testID="im-here" onPress={imHere} style={styles.secondary}>
                  <Icon name="bell-ring-outline" size={18} color={theme.color.onSurface} />
                  <Text style={styles.secondaryText}>Je suis sur place – prévenir le passager</Text>
                </Pressable>
                <Pressable testID="start-ride" onPress={startRide} style={styles.primary}><Text style={styles.primaryText}>Client à bord – démarrer</Text></Pressable>
              </>
            )}
            {activeRide.status === "accepted" && activeRide.arrived_at && (
              <Text style={styles.waitNote} testID="driver-wait-note">⏱️ Attente : 3 min offertes puis 1 €/min{activeRide.breakdown?.waiting > 0 ? ` · déjà +${activeRide.breakdown.waiting.toFixed(2)} €` : ""}</Text>
            )}
            {activeRide.status === "in_progress" && (activeRide.stops || []).length > 0 && (
              <View style={styles.stopsBox}>
                <Text style={styles.stopsTitle}>Arrêts (2 min offertes puis 1 €/min)</Text>
                {(activeRide.stops || []).map((s: any, i: number) => {
                  const w = activeRide.stop_waits?.[i] || {};
                  const done = !!w.departed_at; const active = !!w.active;
                  return (
                    <View key={i} style={styles.stopItem} testID={`driver-stop-${i}`}>
                      <Text style={styles.stopAddr} numberOfLines={1}>{i + 1}. {s.address}</Text>
                      {done ? <Text style={styles.stopDone}>Reparti · +{(w.fee || 0).toFixed(2)} €</Text>
                        : active ? <Pressable testID={`driver-stop-depart-${i}`} onPress={() => stopDepart(i)} style={styles.stopBtn}><Text style={styles.stopBtnText}>Repartir (+{(w.fee || 0).toFixed(2)} €)</Text></Pressable>
                        : <Pressable testID={`driver-stop-arrive-${i}`} onPress={() => stopArrive(i)} style={styles.stopBtn}><Text style={styles.stopBtnText}>Arrivé à l'arrêt</Text></Pressable>}
                    </View>
                  );
                })}
              </View>
            )}
            {activeRide.status === "in_progress" && (
              <Pressable testID="complete-ride" onPress={completeRide} style={[styles.primary, { backgroundColor: theme.color.success }]}><Text style={styles.primaryText}>Terminer la course</Text></Pressable>
            )}
          </ScrollView>
        ) : !online ? (
          <View style={styles.offline}>
            <Icon name="wifi-off" size={40} color={theme.color.onSurfaceTertiary} />
            <Text style={styles.offlineTitle}>Vous êtes hors ligne</Text>
            <Text style={styles.offlineText}>Passez en ligne pour recevoir des demandes de course{user?.manager_name ? ` · Équipe de ${user.manager_name}` : ""}</Text>
          </View>
        ) : (
          <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAvailable(); }} />} showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetTitle}>Demandes disponibles ({rides.length})</Text>
            {loading && rides.length === 0 ? (
              <ActivityIndicator style={{ marginVertical: 40 }} color={theme.color.onSurface} />
            ) : rides.length === 0 ? (
              <View style={styles.empty}><ActivityIndicator color={theme.color.onSurface} /><Text style={styles.emptyText}>En attente de courses…</Text></View>
            ) : rides.map((r) => (
              <View key={r.id} style={[styles.request, r.surcharge_enabled && styles.requestBonus]} testID={`request-${r.id}`}>
                <View style={styles.rowBetween}>
                  <Text style={styles.reqType}>{r.vehicle_type.toUpperCase()}</Text>
                  <Text style={styles.reqPrice}>{money(r.price)}</Text>
                </View>
                <Text style={styles.reqAddr} numberOfLines={1}>{r.pickup.address}</Text>
                <Text style={styles.reqAddrSmall} numberOfLines={1}>→ {r.dropoff.address}</Text>
                <RideTags r={r} />
                <View style={{ flexDirection: "row", gap: theme.spacing.md }}>
                  <Text style={styles.reqMeta}>{r.distance_km.toFixed(1)} km</Text>
                  <Text style={styles.reqMeta}>•</Text>
                  <Text style={styles.reqMeta}>{r.duration_min} min</Text>
                </View>
                <View style={{ flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
                  <Pressable testID={`decline-${r.id}`} onPress={() => decline(r.id)} style={styles.declineBtn}><Text style={styles.declineText}>Refuser</Text></Pressable>
                  <Pressable testID={`accept-${r.id}`} onPress={() => accept(r.id)} style={[styles.acceptBtn, { flex: 2, marginTop: 0 }]}>
                    <Text style={styles.acceptText}>{r.scheduled_at ? "Réserver cette course" : "Accepter"}</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  topBar: { position: "absolute", left: theme.spacing.lg, right: theme.spacing.lg, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  goBtn: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surface, paddingHorizontal: theme.spacing.lg, height: 44, borderRadius: theme.radius.pill, boxShadow: "0 2px 8px rgba(0,0,0,0.15)" },
  goBtnOnline: { backgroundColor: theme.color.success },
  goText: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  gpsChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.color.surface, paddingHorizontal: theme.spacing.md, height: 36, borderRadius: theme.radius.pill, boxShadow: "0 1px 6px rgba(0,0,0,0.12)" },
  gpsChipOn: { backgroundColor: theme.color.brand },
  gpsText: { fontSize: 12, fontWeight: "700", color: theme.color.onSurfaceSecondary },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, top: "42%", backgroundColor: theme.color.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: theme.color.borderStrong, marginBottom: theme.spacing.md },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sheetTitle: { fontSize: 20, fontWeight: "800", color: theme.color.onSurface, marginBottom: theme.spacing.lg, flex: 1 },
  etaPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.color.brand, paddingHorizontal: theme.spacing.md, height: 30, borderRadius: theme.radius.pill, marginBottom: theme.spacing.lg },
  etaText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  blockedCard: { flexDirection: "row", gap: theme.spacing.md, backgroundColor: "#FDECEC", borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.md, borderWidth: 1, borderColor: "#F5B5B5" },
  blockedTitle: { fontSize: 15, fontWeight: "800", color: theme.color.error },
  blockedText: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 2, lineHeight: 18 },
  routeInfo: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: "600", marginBottom: theme.spacing.sm },
  navBtn: { flexDirection: "row", gap: theme.spacing.sm, alignItems: "center", justifyContent: "center", backgroundColor: "#1A73E8", height: 50, borderRadius: theme.radius.pill, marginBottom: theme.spacing.sm },
  navText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  permCard: { flexDirection: "row", gap: theme.spacing.md, backgroundColor: "#FFF7ED", borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.md, borderWidth: 1, borderColor: "#FED7AA" },
  permTitle: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  permText: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 2, lineHeight: 18 },
  permBtn: { backgroundColor: theme.color.brand, paddingHorizontal: theme.spacing.lg, height: 40, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  permBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  permGhost: { paddingHorizontal: theme.spacing.lg, height: 40, alignItems: "center", justifyContent: "center" },
  permGhostText: { color: theme.color.onSurfaceSecondary, fontWeight: "700", fontSize: 13 },
  offline: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.xl },
  offlineTitle: { fontSize: 18, fontWeight: "700", color: theme.color.onSurface },
  offlineText: { fontSize: 14, color: theme.color.onSurfaceSecondary, textAlign: "center" },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: theme.spacing.md },
  emptyText: { fontSize: 14, color: theme.color.onSurfaceSecondary },
  passCard: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  passName: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  passMeta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2, fontWeight: "600" },
  passPrice: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginVertical: theme.spacing.sm },
  tag: { fontSize: 11, fontWeight: "700", color: theme.color.onSurfaceSecondary, backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border, paddingHorizontal: 8, paddingVertical: 3, borderRadius: theme.radius.pill },
  tagSched: { color: theme.color.warning, borderColor: "#F5D8C4" },
  tagBonus: { color: theme.color.success, borderColor: "#BFE3CC", backgroundColor: "#EAF6EE" },
  routeBox: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.md },
  routeRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  routeText: { flex: 1, fontSize: 14, color: theme.color.onSurface, fontWeight: "500" },
  line: { width: 1, height: 12, backgroundColor: theme.color.borderStrong, marginLeft: 4, marginVertical: 6 },
  notes: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.sm },
  primary: { backgroundColor: theme.color.brand, height: 56, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.md },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  secondary: { flexDirection: "row", gap: theme.spacing.sm, height: 48, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: theme.color.borderStrong },
  secondaryText: { color: theme.color.onSurface, fontWeight: "700", fontSize: 14 },
  waitNote: { fontSize: 12, color: theme.color.onSurfaceSecondary, fontWeight: "600", marginTop: theme.spacing.sm, textAlign: "center" },
  stopsBox: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginTop: theme.spacing.md, gap: theme.spacing.sm },
  stopsTitle: { fontSize: 12, fontWeight: "800", color: theme.color.onSurfaceSecondary },
  stopItem: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  stopAddr: { flex: 1, fontSize: 13, color: theme.color.onSurface, fontWeight: "600" },
  stopDone: { fontSize: 12, color: theme.color.success, fontWeight: "700" },
  stopBtn: { backgroundColor: theme.color.brand, borderRadius: theme.radius.pill, paddingHorizontal: theme.spacing.md, height: 34, justifyContent: "center" },
  stopBtnText: { color: theme.color.onBrand, fontSize: 12, fontWeight: "800" },
  request: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.md, borderWidth: 2, borderColor: "transparent" },
  requestBonus: { borderColor: theme.color.success },
  reqType: { fontSize: 11, fontWeight: "800", color: theme.color.onSurfaceSecondary, letterSpacing: 0.5 },
  reqPrice: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  reqAddr: { fontSize: 15, fontWeight: "600", color: theme.color.onSurface, marginTop: theme.spacing.sm },
  reqAddrSmall: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 4 },
  reqMeta: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontWeight: "600" },
  declineBtn: { flex: 1, height: 44, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: theme.color.borderStrong },
  declineText: { fontWeight: "800", color: theme.color.onSurfaceSecondary, fontSize: 14 },
  acceptBtn: { backgroundColor: theme.color.brand, height: 44, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.md },
  acceptText: { color: "#fff", fontWeight: "800", fontSize: 14 },
});

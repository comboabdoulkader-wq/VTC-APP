import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl, Share, Platform, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import { fmtDateTime, money } from "@/src/utils/format";
import { useI18n } from "@/src/i18n";
import PartnerBookingForm from "@/src/components/company/PartnerBookingForm";

const STATUS_COLORS: Record<string, string> = { requested: theme.color.warning, accepted: theme.color.success, in_progress: theme.color.success, completed: theme.color.onSurfaceSecondary, cancelled: theme.color.error };

/** Partner space (hotels, concierges, agencies): book rides for guests and follow them live. */
export default function PartnerBookings() {
  const { token } = useAuth();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [rides, setRides] = useState<any[]>([]);
  const [info, setInfo] = useState<any>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, i] = await Promise.all([apiFetch<any[]>(`/company/bookings${filter === "active" ? "?status=active" : ""}`, {}, token), apiFetch<any>("/company/partner", {}, token)]);
      setRides(r); setInfo(i);
    } catch {} finally { setRefreshing(false); }
  }, [token, filter]);
  useEffect(() => { load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, [load]);

  const share = async (r: any) => {
    const url = `${info?.tracking_base || ""}/${r.share_token}`;
    const msg = `Suivi en direct du chauffeur de ${r.guest_name || r.passenger_label} : ${url}`;
    if (Platform.OS === "web") { try { await navigator.clipboard.writeText(url); window.alert(`Lien de suivi copié :\n${url}`); } catch { window.alert(`Lien de suivi :\n${url}`); } return; }
    await Share.share({ message: msg, url });
  };
  const cancel = (r: any) => {
    const doIt = async () => { try { await apiFetch(`/rides/${r.id}/cancel`, { method: "POST" }, token); load(); } catch (e: any) { Alert.alert("Erreur", e.message); } };
    if (Platform.OS === "web") { if (window.confirm(`Annuler la course de ${r.guest_name || r.passenger_label} ?`)) doIt(); return; }
    Alert.alert("Annuler la course", `${r.guest_name || r.passenger_label} · ${r.booking_ref}`, [{ text: "Non", style: "cancel" }, { text: "Annuler la course", style: "destructive", onPress: doIt }]);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + theme.spacing.md }]} testID="partner-bookings">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit>Réservations clients</Text>
          <Text style={styles.subtitle}>{info?.company_name}{info?.partner_discount ? ` · tarif partenaire −${Math.round(info.partner_discount * 100)} %` : ""}</Text>
        </View>
        <Pressable testID="partner-new" onPress={() => setShowForm(true)} style={styles.newBtn}><Icon name="plus" size={20} color={theme.color.onBrand} /><Text style={styles.newText}>Réserver</Text></Pressable>
      </View>
      <View style={styles.filters}>
        {(["active", "all"] as const).map((f) => (
          <Pressable key={f} testID={`partner-filter-${f}`} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}><Text style={[styles.chipText, filter === f && { color: theme.color.onBrand }]}>{f === "active" ? `En cours (${info?.active_bookings ?? 0})` : "Toutes"}</Text></Pressable>
        ))}
      </View>
      <FlatList
        data={rides}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: theme.spacing.xl, paddingBottom: insets.bottom + 100, gap: theme.spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
        ListEmptyComponent={<View style={styles.empty}><Icon name="bell-sleep-outline" size={40} color={theme.color.onSurfaceTertiary} /><Text style={styles.emptyText}>Aucune réservation {filter === "active" ? "en cours" : ""}</Text><Text style={styles.emptyHint}>Réservez un chauffeur pour un client : il reçoit un SMS avec le suivi en direct.</Text></View>}
        renderItem={({ item: r }) => (
          <View style={styles.card} testID={`booking-${r.id}`}>
            <View style={styles.cardHead}>
              <Text style={styles.guest} numberOfLines={1}>{r.guest_name || r.passenger_label}{r.room ? ` · ch. ${r.room}` : ""}</Text>
              <View style={[styles.badge, { backgroundColor: STATUS_COLORS[r.status] }]}><Text style={styles.badgeText}>{t(`st_${r.status}` as any)}</Text></View>
            </View>
            <Text style={styles.meta}>{r.booking_ref} · {r.scheduled_at ? fmtDateTime(r.scheduled_at) : fmtDateTime(r.created_at)} · {r.service_label}</Text>
            <Text style={styles.route} numberOfLines={1}>{r.pickup.address}</Text>
            <Text style={styles.route} numberOfLines={1}>→ {r.dropoff.address}</Text>
            {r.driver_name ? <Text style={styles.driver}>🚘 {r.driver_name} · {r.driver_vehicle} ({r.driver_plate}){r.status === "accepted" ? " · en route" : r.status === "in_progress" ? " · client à bord" : ""}</Text> : r.status === "requested" ? <Text style={styles.driver}>⏳ Recherche d'un chauffeur…</Text> : null}
            {r.flight?.number ? <Text style={styles.driver}>✈️ {r.flight.number}{r.flight.arrival_delay_min > 0 ? ` · retard +${r.flight.arrival_delay_min} min` : ""}</Text> : null}
            <View style={styles.footer}>
              <Text style={styles.price}>{money(r.price)}{r.partner_discount_amount ? <Text style={styles.saved}>  (−{money(r.partner_discount_amount)})</Text> : null}</Text>
              <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
                {["requested", "accepted", "in_progress"].includes(r.status) && <Pressable testID={`booking-share-${r.id}`} onPress={() => share(r)} style={styles.iconBtn}><Icon name="share-variant-outline" size={20} color={theme.color.onSurface} /></Pressable>}
                {["requested", "accepted"].includes(r.status) && <Pressable testID={`booking-cancel-${r.id}`} onPress={() => cancel(r)} style={styles.iconBtn}><Icon name="close-circle-outline" size={20} color={theme.color.error} /></Pressable>}
              </View>
            </View>
          </View>
        )}
      />
      <PartnerBookingForm visible={showForm} onClose={() => setShowForm(false)} onCreated={() => { setFilter("active"); load(); }} discount={info?.partner_discount || 0} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.xl },
  title: { fontSize: 28, fontWeight: "800", color: theme.color.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  newBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.color.brand, height: 44, paddingHorizontal: theme.spacing.lg, borderRadius: theme.radius.pill },
  newText: { color: theme.color.onBrand, fontWeight: "800" },
  filters: { flexDirection: "row", gap: theme.spacing.sm, paddingHorizontal: theme.spacing.xl, marginTop: theme.spacing.lg },
  chip: { height: 36, paddingHorizontal: theme.spacing.lg, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: theme.color.brand }, chipText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.lg, padding: theme.spacing.lg },
  cardHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  guest: { flex: 1, fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  badge: { paddingHorizontal: 10, height: 24, borderRadius: theme.radius.pill, justifyContent: "center" }, badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  meta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 4, marginBottom: theme.spacing.sm },
  route: { fontSize: 14, color: theme.color.onSurface }, driver: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.sm },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: theme.spacing.md },
  price: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface }, saved: { fontSize: 12, fontWeight: "600", color: theme.color.success },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingTop: 60, gap: theme.spacing.sm, paddingHorizontal: theme.spacing.xl },
  emptyText: { fontSize: 16, fontWeight: "700", color: theme.color.onSurfaceSecondary }, emptyHint: { fontSize: 13, color: theme.color.onSurfaceTertiary, textAlign: "center", lineHeight: 18 },
});

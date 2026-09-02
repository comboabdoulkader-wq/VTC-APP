import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, RefreshControl, Alert } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import PrivateRideForm from "@/src/components/driver/PrivateRideForm";
import { money, fmtDateTime, STATUS_LABELS } from "@/src/utils/format";

type Ride = any;
const COMMISSION = 0.15;

export default function PrivateRides() {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<"upcoming" | "done">("upcoming");

  const load = useCallback(async () => {
    try { setRides(await apiFetch<Ride[]>("/driver/private-rides", {}, token)); } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const update = async (id: string, status: string) => {
    try {
      const r = await apiFetch<Ride>(`/driver/private-rides/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }, token);
      setRides((list) => list.map((x) => (x.id === id ? r : x)));
      if (status === "completed") Alert.alert("Course clôturée", `Commission plateforme : ${money(r.commission_amount)}\nNet chauffeur : ${money(r.price - r.commission_amount)}`);
    } catch (e: any) { Alert.alert("Erreur", e.message); }
  };

  const remove = (id: string) => {
    const doIt = async () => { try { await apiFetch(`/driver/private-rides/${id}`, { method: "DELETE" }, token); setRides((l) => l.filter((x) => x.id !== id)); } catch {} };
    Alert.alert("Supprimer", "Supprimer cette course privée ?", [{ text: "Annuler", style: "cancel" }, { text: "Supprimer", style: "destructive", onPress: doIt }]);
  };

  const upcoming = rides.filter((r) => ["accepted", "in_progress"].includes(r.status)).sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
  const done = rides.filter((r) => ["completed", "cancelled"].includes(r.status));
  const list = filter === "upcoming" ? upcoming : done;
  const totalDone = done.filter((r) => r.status === "completed").reduce((s, r) => s + r.price, 0);
  const totalCommission = done.reduce((s, r) => s + (r.commission_amount || 0), 0);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="private-rides-screen">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Courses privées</Text>
          <Text style={styles.subtitle}>Votre clientèle personnelle, centralisée</Text>
        </View>
        <Pressable testID="add-private-ride" onPress={() => setShowForm(true)} style={styles.addBtn}>
          <Icon name="plus" size={22} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}><Text style={styles.statVal}>{upcoming.length}</Text><Text style={styles.statLabel}>à venir</Text></View>
        <View style={styles.stat}><Text style={styles.statVal}>{money(totalDone)}</Text><Text style={styles.statLabel}>encaissé</Text></View>
        <View style={styles.stat}><Text style={[styles.statVal, { color: theme.color.warning }]}>{money(totalCommission)}</Text><Text style={styles.statLabel}>commission 15 %</Text></View>
      </View>

      <View style={styles.segment}>
        {(["upcoming", "done"] as const).map((f) => (
          <Pressable key={f} testID={`private-filter-${f}`} onPress={() => setFilter(f)} style={[styles.segBtn, filter === f && styles.segBtnActive]}>
            <Text style={[styles.segText, filter === f && styles.segTextActive]}>{f === "upcoming" ? `Planning (${upcoming.length})` : `Historique (${done.length})`}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.onSurface} /> : (
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
          {list.length === 0 ? (
            <View style={styles.empty}>
              <Icon name="notebook-outline" size={56} color={theme.color.onSurfaceTertiary} />
              <Text style={styles.emptyText}>{filter === "upcoming" ? "Aucune course privée planifiée" : "Aucune course clôturée"}</Text>
              {filter === "upcoming" && <Pressable testID="empty-add-private" onPress={() => setShowForm(true)} style={styles.emptyBtn}><Text style={styles.emptyBtnText}>Ajouter une course</Text></Pressable>}
            </View>
          ) : list.map((r) => {
            const st = STATUS_LABELS[r.status];
            return (
              <View key={r.id} style={styles.card} testID={`private-ride-${r.id}`}>
                <View style={styles.rowBetween}>
                  <Text style={styles.date}>📅 {fmtDateTime(r.scheduled_at)}</Text>
                  <View style={[styles.badge, { backgroundColor: st.color + "22" }]}><Text style={[styles.badgeText, { color: st.color }]}>{r.status === "accepted" ? "Planifiée" : st.label}</Text></View>
                </View>
                <Text style={styles.client}>{r.passenger_name}{r.passenger_phone ? ` · ${r.passenger_phone}` : ""}</Text>
                <View style={styles.route}><Icon name="circle" size={10} color={theme.color.success} /><Text style={styles.routeText} numberOfLines={1}>{r.pickup.address}</Text></View>
                <View style={styles.route}><Icon name="map-marker" size={12} color={theme.color.error} /><Text style={styles.routeText} numberOfLines={1}>{r.dropoff.address}</Text></View>
                {r.notes ? <Text style={styles.notes}>📝 {r.notes}</Text> : null}
                <View style={[styles.rowBetween, styles.footer]}>
                  <Text style={styles.pay}>{r.payment_method === "card" ? "💳 Carte" : "💵 Espèces"}</Text>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.price}>{money(r.price)}</Text>
                    {r.status === "completed" && <Text style={styles.commission}>− {money(r.commission_amount)} commission</Text>}
                  </View>
                </View>
                {r.status === "accepted" && (
                  <View style={styles.actions}>
                    <Pressable testID={`private-delete-${r.id}`} onPress={() => remove(r.id)} style={styles.ghostBtn}><Icon name="trash-can-outline" size={18} color={theme.color.error} /></Pressable>
                    <Pressable testID={`private-start-${r.id}`} onPress={() => update(r.id, "in_progress")} style={styles.outlineBtn}><Text style={styles.outlineText}>Démarrer</Text></Pressable>
                    <Pressable testID={`private-complete-${r.id}`} onPress={() => update(r.id, "completed")} style={styles.doneBtn}><Text style={styles.doneText}>Clôturer</Text></Pressable>
                  </View>
                )}
                {r.status === "in_progress" && (
                  <View style={styles.actions}>
                    <Pressable testID={`private-complete-${r.id}`} onPress={() => update(r.id, "completed")} style={[styles.doneBtn, { flex: 1 }]}><Text style={styles.doneText}>Terminer et clôturer</Text></Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      <PrivateRideForm visible={showForm} onClose={() => setShowForm(false)} onCreated={(r) => setRides((l) => [r, ...l])} commissionRate={COMMISSION} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg },
  title: { fontSize: 30, fontWeight: "800", color: theme.color.onSurface, letterSpacing: -1 },
  subtitle: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  addBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center" },
  stats: { flexDirection: "row", gap: theme.spacing.sm, paddingHorizontal: theme.spacing.xl, marginBottom: theme.spacing.md },
  stat: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, alignItems: "center" },
  statVal: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  statLabel: { fontSize: 11, color: theme.color.onSurfaceTertiary, fontWeight: "600", marginTop: 2 },
  segment: { flexDirection: "row", marginHorizontal: theme.spacing.xl, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, padding: 4 },
  segBtn: { flex: 1, height: 36, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  segBtnActive: { backgroundColor: theme.color.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, elevation: 1 },
  segText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurfaceSecondary },
  segTextActive: { color: theme.color.onSurface },
  empty: { alignItems: "center", paddingVertical: 50, gap: theme.spacing.md },
  emptyText: { fontSize: 15, color: theme.color.onSurfaceTertiary, fontWeight: "600" },
  emptyBtn: { backgroundColor: theme.color.brand, paddingHorizontal: theme.spacing.xl, height: 44, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  emptyBtnText: { color: "#fff", fontWeight: "800" },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  date: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: "600" },
  badge: { paddingHorizontal: theme.spacing.sm, paddingVertical: 4, borderRadius: theme.radius.pill },
  badgeText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  client: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, marginVertical: theme.spacing.sm },
  route: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginBottom: 6 },
  routeText: { flex: 1, fontSize: 14, color: theme.color.onSurface, fontWeight: "500" },
  notes: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 4 },
  footer: { marginTop: theme.spacing.md, paddingTop: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.color.border },
  pay: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: "600" },
  price: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  commission: { fontSize: 11, color: theme.color.warning, fontWeight: "700" },
  actions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
  ghostBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface },
  outlineBtn: { flex: 1, height: 44, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: theme.color.borderStrong },
  outlineText: { fontWeight: "800", color: theme.color.onSurface, fontSize: 14 },
  doneBtn: { flex: 1, height: 44, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.success },
  doneText: { fontWeight: "800", color: "#fff", fontSize: 14 },
});

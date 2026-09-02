import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import AddMemberForm from "@/src/components/driver/AddMemberForm";
import MemberDetail, { Member } from "@/src/components/driver/MemberDetail";
import { money } from "@/src/utils/format";

type Overview = { members_count: number; online_count: number; active_count: number; gross: number; commission: number; net: number; completed_rides: number };

export default function Team() {
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Member | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, o] = await Promise.all([apiFetch<Member[]>("/team/members", {}, token), apiFetch<Overview>("/team/overview", {}, token)]);
      setMembers(m); setOverview(o);
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useFocusEffect(useCallback(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]));

  const onChanged = (m: Member) => { setMembers((l) => l.map((x) => (x.id === m.id ? { ...x, ...m } : x))); setSelected((s) => (s && s.id === m.id ? { ...s, ...m } : s)); };

  if (user?.manager_id) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]} testID="team-member-view">
        <Icon name="account-group" size={64} color={theme.color.onSurfaceTertiary} />
        <Text style={styles.emptyTitle}>Équipe de {user.manager_name}</Text>
        <Text style={styles.emptyText}>Vous faites partie de cette équipe. Votre gestionnaire peut vous affecter des courses directement : elles apparaîtront dans votre accueil.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="team-screen">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Mon équipe</Text>
          <Text style={styles.subtitle}>Gérez vos chauffeurs depuis un seul compte</Text>
        </View>
        <Pressable testID="add-member" onPress={() => setShowAdd(true)} style={styles.addBtn}><Icon name="account-plus" size={22} color="#fff" /></Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: insets.bottom + 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
        {overview && (
          <View style={styles.hero} testID="team-overview">
            <View style={styles.heroRow}>
              <View><Text style={styles.heroLabel}>Chiffre d'affaires équipe</Text><Text style={styles.heroValue}>{money(overview.gross)}</Text></View>
              <View style={{ alignItems: "flex-end" }}><Text style={styles.heroLabel}>Commissions</Text><Text style={styles.heroSmall}>{money(overview.commission)}</Text></View>
            </View>
            <View style={styles.heroStats}>
              <Text style={styles.heroStat}>👥 {overview.members_count} chauffeur{overview.members_count > 1 ? "s" : ""}</Text>
              <Text style={styles.heroStat}>🟢 {overview.online_count} en ligne</Text>
              <Text style={styles.heroStat}>🚗 {overview.active_count} en course</Text>
              <Text style={styles.heroStat}>✅ {overview.completed_rides} terminées</Text>
            </View>
          </View>
        )}

        {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.onSurface} /> : members.length === 0 ? (
          <View style={styles.center}>
            <Icon name="account-group-outline" size={64} color={theme.color.onSurfaceTertiary} />
            <Text style={styles.emptyTitle}>Créez votre équipe</Text>
            <Text style={styles.emptyText}>Ajoutez des chauffeurs, affectez-leur des courses, suivez leurs revenus et commissions.</Text>
            <Pressable testID="empty-add-member" onPress={() => setShowAdd(true)} style={styles.emptyBtn}><Text style={styles.emptyBtnText}>Ajouter un chauffeur</Text></Pressable>
          </View>
        ) : members.map((m) => (
          <Pressable key={m.id} testID={`member-${m.id}`} onPress={() => setSelected(m)} style={[styles.card, !m.is_active && { opacity: 0.55 }]}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{m.full_name[0]}</Text><View style={[styles.onlineDot, { backgroundColor: m.is_online ? theme.color.success : theme.color.borderStrong }]} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{m.full_name}{!m.is_active ? "  · désactivé" : ""}</Text>
              <Text style={styles.meta}>{m.vehicle_model || "Véhicule"} · {m.license_plate || "—"} · ★ {m.rating.toFixed(1)}</Text>
              <Text style={styles.meta2}>
                {m.active_ride_status ? (m.active_ride_status === "in_progress" ? "🚗 En course" : "🧭 En route vers un passager") : m.is_online ? "Disponible" : "Hors ligne"}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.gross}>{money(m.net)}</Text>
              <Text style={styles.meta}>{m.completed_rides} course{m.completed_rides > 1 ? "s" : ""}</Text>
            </View>
            <Icon name="chevron-right" size={22} color={theme.color.onSurfaceTertiary} />
          </Pressable>
        ))}
      </ScrollView>

      <AddMemberForm visible={showAdd} onClose={() => setShowAdd(false)} onCreated={(m) => { setMembers((l) => [...l, m]); load(); }} />
      <MemberDetail member={selected} onClose={() => setSelected(null)} onChanged={onChanged} onRemoved={(id) => { setMembers((l) => l.filter((x) => x.id !== id)); load(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  center: { alignItems: "center", justifyContent: "center", gap: theme.spacing.md, paddingVertical: 50, paddingHorizontal: theme.spacing.xl },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg },
  title: { fontSize: 30, fontWeight: "800", color: theme.color.onSurface, letterSpacing: -1 },
  subtitle: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  addBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center" },
  hero: { backgroundColor: theme.color.brand, borderRadius: theme.radius.lg, padding: theme.spacing.xl, marginBottom: theme.spacing.lg },
  heroRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  heroLabel: { color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: "600" },
  heroValue: { color: "#fff", fontSize: 34, fontWeight: "800", letterSpacing: -1 },
  heroSmall: { color: "#fff", fontSize: 18, fontWeight: "800" },
  heroStats: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md, marginTop: theme.spacing.md },
  heroStat: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: "600" },
  emptyTitle: { fontSize: 20, fontWeight: "800", color: theme.color.onSurface },
  emptyText: { fontSize: 14, color: theme.color.onSurfaceSecondary, textAlign: "center", lineHeight: 20 },
  emptyBtn: { backgroundColor: theme.color.brand, paddingHorizontal: theme.spacing.xl, height: 48, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.sm },
  emptyBtnText: { color: "#fff", fontWeight: "800" },
  card: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  onlineDot: { position: "absolute", right: -1, bottom: -1, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: theme.color.surfaceSecondary },
  name: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  meta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  meta2: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2, fontWeight: "600" },
  gross: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
});

import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Switch, Alert } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import SheetModal from "@/src/components/ui/SheetModal";
import { apiFetch, useAuth } from "@/src/context/auth";
import { money, fmtDateTime, STATUS_LABELS } from "@/src/utils/format";

export type Member = {
  id: string; full_name: string; email: string; phone?: string | null; vehicle_model?: string | null; license_plate?: string | null;
  rating: number; is_active: boolean; is_online: boolean; completed_rides: number; gross: number; commission: number; net: number;
  active_ride_id?: string | null; active_ride_status?: string | null;
};

type Props = { member: Member | null; onClose: () => void; onChanged: (m: Member) => void; onRemoved: (id: string) => void };

export default function MemberDetail({ member, onClose, onChanged, onRemoved }: Props) {
  const { token } = useAuth();
  const [rides, setRides] = useState<any[]>([]);
  const [open, setOpen] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);

  const load = useCallback(async () => {
    if (!member) return;
    setLoading(true);
    try {
      const [r, o] = await Promise.all([
        apiFetch<any[]>(`/team/members/${member.id}/rides`, {}, token),
        apiFetch<any[]>("/rides/available", {}, token),
      ]);
      setRides(r); setOpen(o);
    } catch {} finally { setLoading(false); }
  }, [member?.id, token]);

  useEffect(() => { setShowAssign(false); load(); }, [load]);

  const toggleActive = async (v: boolean) => {
    if (!member) return;
    try { onChanged(await apiFetch<Member>(`/team/members/${member.id}`, { method: "PATCH", body: JSON.stringify({ is_active: v }) }, token)); } catch (e: any) { Alert.alert("Erreur", e.message); }
  };

  const assign = async (rideId: string) => {
    if (!member) return;
    setAssigning(rideId);
    try {
      await apiFetch("/team/assign", { method: "POST", body: JSON.stringify({ ride_id: rideId, driver_id: member.id }), }, token);
      setShowAssign(false);
      load();
      onChanged({ ...member, active_ride_id: rideId, active_ride_status: "accepted" });
    } catch (e: any) { Alert.alert("Affectation impossible", e.message); } finally { setAssigning(null); }
  };

  const remove = () => {
    if (!member) return;
    Alert.alert("Retirer de l'équipe", `${member.full_name} gardera son compte mais ne fera plus partie de votre équipe.`, [
      { text: "Annuler", style: "cancel" },
      { text: "Retirer", style: "destructive", onPress: async () => { try { await apiFetch(`/team/members/${member.id}`, { method: "DELETE" }, token); onRemoved(member.id); onClose(); } catch {} } },
    ]);
  };

  if (!member) return null;
  return (
    <SheetModal visible={!!member} onClose={onClose} title={member.full_name} subtitle={`${member.vehicle_model || "Véhicule"} · ${member.license_plate || "—"} · ${member.email}`} testID="member-detail">
      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: member.is_online ? theme.color.success : theme.color.borderStrong }]} />
        <Text style={styles.statusText}>{member.is_online ? "En ligne" : "Hors ligne"}{member.active_ride_status ? ` · course ${STATUS_LABELS[member.active_ride_status]?.label.toLowerCase()}` : ""}</Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.switchLabel}>{member.is_active ? "Actif" : "Désactivé"}</Text>
        <Switch testID="member-active-switch" value={member.is_active} onValueChange={toggleActive} trackColor={{ true: theme.color.success, false: theme.color.borderStrong }} thumbColor="#fff" />
      </View>

      <View style={styles.kpis}>
        <View style={styles.kpi}><Text style={styles.kpiVal}>{member.completed_rides}</Text><Text style={styles.kpiLabel}>courses</Text></View>
        <View style={styles.kpi}><Text style={styles.kpiVal}>{money(member.gross)}</Text><Text style={styles.kpiLabel}>brut</Text></View>
        <View style={styles.kpi}><Text style={[styles.kpiVal, { color: theme.color.warning }]}>{money(member.commission)}</Text><Text style={styles.kpiLabel}>commissions</Text></View>
        <View style={styles.kpi}><Text style={styles.kpiVal}>★ {member.rating.toFixed(1)}</Text><Text style={styles.kpiLabel}>note</Text></View>
      </View>

      <Pressable testID="assign-toggle" disabled={!member.is_active || !!member.active_ride_id} onPress={() => setShowAssign((s) => !s)}
        style={[styles.assignBtn, (!member.is_active || !!member.active_ride_id) && { opacity: 0.5 }]}>
        <Icon name="account-arrow-right" size={18} color="#fff" />
        <Text style={styles.assignText}>{member.active_ride_id ? "Course en cours" : `Affecter une course (${open.length} dispo)`}</Text>
      </Pressable>

      {showAssign && (
        <View style={styles.assignList} testID="assign-list">
          {open.length === 0 ? <Text style={styles.emptyText}>Aucune demande ouverte pour le moment</Text> : open.map((r) => (
            <Pressable key={r.id} testID={`assign-${r.id}`} onPress={() => assign(r.id)} disabled={!!assigning} style={styles.openRide}>
              <View style={{ flex: 1 }}>
                <Text style={styles.openRoute} numberOfLines={1}>{r.pickup.address}</Text>
                <Text style={styles.openRoute2} numberOfLines={1}>→ {r.dropoff.address}</Text>
                <Text style={styles.openMeta}>{r.scheduled_at ? `📅 ${fmtDateTime(r.scheduled_at)}` : "⚡ Immédiat"}{r.surcharge_enabled ? " · rallonge" : ""}</Text>
              </View>
              {assigning === r.id ? <ActivityIndicator color={theme.color.onSurface} /> : <Text style={styles.openPrice}>{money(r.price)}</Text>}
            </Pressable>
          ))}
        </View>
      )}

      <Text style={styles.section}>Activité récente</Text>
      {loading ? <ActivityIndicator color={theme.color.onSurface} /> : rides.length === 0 ? <Text style={styles.emptyText}>Aucune course</Text> : rides.slice(0, 20).map((r) => {
        const st = STATUS_LABELS[r.status];
        return (
          <View key={r.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>{r.source === "private" ? "🔒 " : ""}{r.dropoff.address}</Text>
              <Text style={styles.rowMeta}>{fmtDateTime(r.scheduled_at || r.created_at)} · <Text style={{ color: st.color }}>{st.label}</Text></Text>
            </View>
            <Text style={styles.rowPrice}>{money(r.price)}</Text>
          </View>
        );
      })}

      <Pressable testID="member-remove" onPress={remove} style={styles.removeBtn}><Text style={styles.removeText}>Retirer de l'équipe</Text></Pressable>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 13, fontWeight: "600", color: theme.color.onSurfaceSecondary },
  switchLabel: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  kpis: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  kpi: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.sm, alignItems: "center" },
  kpiVal: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  kpiLabel: { fontSize: 10, color: theme.color.onSurfaceTertiary, fontWeight: "600", marginTop: 2 },
  assignBtn: { flexDirection: "row", gap: theme.spacing.sm, backgroundColor: theme.color.brand, height: 50, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  assignText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  assignList: { marginTop: theme.spacing.md, gap: theme.spacing.sm },
  openRide: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md },
  openRoute: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  openRoute2: { fontSize: 13, color: theme.color.onSurfaceSecondary },
  openMeta: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 2, fontWeight: "600" },
  openPrice: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  section: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, marginTop: theme.spacing.xl, marginBottom: theme.spacing.sm },
  emptyText: { fontSize: 13, color: theme.color.onSurfaceTertiary, paddingVertical: theme.spacing.md },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  rowTitle: { fontSize: 14, fontWeight: "600", color: theme.color.onSurface },
  rowMeta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  rowPrice: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  removeBtn: { marginTop: theme.spacing.xl, height: 48, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary },
  removeText: { color: theme.color.error, fontWeight: "700" },
});

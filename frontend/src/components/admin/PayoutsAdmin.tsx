import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Platform, Alert, Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import { money, fmtDateTime } from "@/src/utils/format";
import SheetModal from "@/src/components/ui/SheetModal";

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

type Payout = { id: string; partner_name: string; amount: number; status: string; note: string | null; created_at: string; settled_at: string | null; settled_by: string | null };
type Data = { payouts: Payout[]; pending_count: number; pending_total: number };

const STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "En attente", color: theme.color.warning },
  paid: { label: "Réglé", color: theme.color.success },
  rejected: { label: "Refusé", color: theme.color.error },
};

const confirm = (msg: string, cb: () => void) => {
  if (Platform.OS === "web") { if (window.confirm(msg)) cb(); return; }
  Alert.alert("Confirmer", msg, [{ text: "Annuler", style: "cancel" }, { text: "Confirmer", onPress: cb }]);
};

/** Moderator console: validate and track partner payout requests. */
export default function PayoutsAdmin({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await apiFetch<Data>(`/company/admin/payouts${filter === "pending" ? "?status=pending" : ""}`, {}, token)); }
    catch { setData(null); } finally { setLoading(false); }
  }, [token, filter]);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  const download = async (fmt: "csv" | "pdf") => {
    const s = filter === "pending" ? "&status=pending" : "";
    const url = `${API}/api/company/admin/payouts/export.${fmt}?token=${token}${s}`;
    if (Platform.OS === "web") Linking.openURL(url); else await WebBrowser.openBrowserAsync(url);
  };

  const decide = (p: Payout, status: "paid" | "rejected") => {
    const verb = status === "paid" ? "Marquer comme réglé" : "Refuser (remboursement au portefeuille)";
    confirm(`${verb} · ${p.partner_name} · ${money(p.amount)} ?`, async () => {
      setBusy(p.id);
      try { await apiFetch(`/company/admin/payouts/${p.id}`, { method: "PATCH", body: JSON.stringify({ status }) }, token); load(); }
      catch (e: any) { if (Platform.OS === "web") window.alert(e.message); else Alert.alert("Erreur", e.message); }
      finally { setBusy(null); }
    });
  };

  return (
    <SheetModal visible={visible} onClose={onClose} title="Versements partenaires" subtitle="Valider et suivre les demandes de versement" testID="payouts-admin">
      <View style={styles.filters}>
        {(["pending", "all"] as const).map((f) => (
          <Pressable key={f} testID={`payout-filter-${f}`} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
            <Text style={[styles.chipText, filter === f && { color: theme.color.onBrand }]}>{f === "pending" ? `En attente (${data?.pending_count ?? 0})` : "Toutes"}</Text>
          </Pressable>
        ))}
      </View>
      {filter === "pending" && (data?.pending_total ?? 0) > 0 ? <Text style={styles.total}>À régler : <Text style={{ fontWeight: "800", color: theme.color.onSurface }}>{money(data?.pending_total)}</Text></Text> : null}

      <View style={styles.exportRow}>
        <Pressable testID="payouts-export-csv" onPress={() => download("csv")} style={styles.exportBtn}><Icon name="file-delimited-outline" size={16} color={theme.color.onSurface} /><Text style={styles.exportText}>Export CSV</Text></Pressable>
        <Pressable testID="payouts-export-pdf" onPress={() => download("pdf")} style={styles.exportBtn}><Icon name="file-pdf-box" size={16} color={theme.color.onSurface} /><Text style={styles.exportText}>Export PDF</Text></Pressable>
      </View>

      {loading ? <ActivityIndicator style={{ marginVertical: 24 }} color={theme.color.onSurface} /> : (
        data && data.payouts.length > 0 ? data.payouts.map((p) => {
          const s = STATUS[p.status] || STATUS.pending;
          return (
            <View key={p.id} style={styles.card} testID={`payout-${p.id}`}>
              <View style={styles.head}>
                <Text style={styles.partner} numberOfLines={1}>{p.partner_name}</Text>
                <View style={[styles.badge, { backgroundColor: s.color }]}><Text style={styles.badgeText}>{s.label}</Text></View>
              </View>
              <Text style={styles.amount}>{money(p.amount)}</Text>
              <Text style={styles.meta}>Demandé le {fmtDateTime(p.created_at)}</Text>
              {p.settled_at ? <Text style={styles.meta}>Traité le {fmtDateTime(p.settled_at)}{p.settled_by ? ` · ${p.settled_by}` : ""}{p.note ? ` · ${p.note}` : ""}</Text> : null}
              {p.status === "pending" && (
                <View style={styles.actions}>
                  <Pressable testID={`payout-reject-${p.id}`} disabled={busy === p.id} onPress={() => decide(p, "rejected")} style={[styles.btn, styles.reject]}><Text style={styles.rejectText}>Refuser</Text></Pressable>
                  <Pressable testID={`payout-pay-${p.id}`} disabled={busy === p.id} onPress={() => decide(p, "paid")} style={[styles.btn, styles.pay]}>{busy === p.id ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={styles.payText}>Marquer réglé</Text>}</Pressable>
                </View>
              )}
            </View>
          );
        }) : <View style={styles.empty}><Icon name="bank-transfer" size={40} color={theme.color.onSurfaceTertiary} /><Text style={styles.emptyText}>Aucune demande {filter === "pending" ? "en attente" : ""}</Text></View>
      )}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  chip: { height: 36, paddingHorizontal: theme.spacing.lg, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: theme.color.brand }, chipText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  total: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginBottom: theme.spacing.md },
  exportRow: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  exportBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border },
  exportText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.lg, padding: theme.spacing.lg, marginBottom: theme.spacing.md },
  head: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  partner: { flex: 1, fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  badge: { paddingHorizontal: 10, height: 24, borderRadius: theme.radius.pill, justifyContent: "center" }, badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
  amount: { fontSize: 22, fontWeight: "800", color: theme.color.onSurface, marginTop: 6 },
  meta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 4 },
  actions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
  btn: { flex: 1, height: 44, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center" },
  reject: { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.error }, rejectText: { color: theme.color.error, fontWeight: "800" },
  pay: { backgroundColor: theme.color.brand }, payText: { color: theme.color.onBrand, fontWeight: "800" },
  empty: { alignItems: "center", paddingTop: 40, gap: theme.spacing.sm }, emptyText: { fontSize: 15, fontWeight: "700", color: theme.color.onSurfaceSecondary },
});

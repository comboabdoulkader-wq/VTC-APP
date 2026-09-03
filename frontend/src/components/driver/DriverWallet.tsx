import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Platform, Alert } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import { money, fmtDateTime } from "@/src/utils/format";
import SheetModal from "@/src/components/ui/SheetModal";

type Tx = { id: string; type: string; label: string; amount: number; created_at: string };
type Payout = { id: string; amount: number; status: string; created_at: string };
type Data = { balance: number; transactions: Tx[]; payouts: Payout[]; min_payout: number };

const STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "En attente", color: theme.color.warning }, paid: { label: "Réglé", color: theme.color.success }, rejected: { label: "Refusé", color: theme.color.error },
};
const notify = (t: string, m?: string) => { if (Platform.OS === "web") window.alert(m ? `${t}\n\n${m}` : t); else Alert.alert(t, m); };

/** Driver earnings wallet: balance, history and on-demand payout request. */
export default function DriverWallet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setLoading(true); try { setD(await apiFetch<Data>("/driver/wallet", {}, token)); } catch { setD(null); } finally { setLoading(false); } }, [token]);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  const request = async () => {
    const a = parseFloat(amount.replace(",", "."));
    if (!a || a <= 0) { notify("Montant invalide"); return; }
    setBusy(true);
    try { const r = await apiFetch<any>("/driver/wallet/payout", { method: "POST", body: JSON.stringify({ amount: a }) }, token); setAmount(""); notify("Demande envoyée", `Versement de ${money(r.amount)} demandé. Solde : ${money(r.balance)}.`); load(); }
    catch (e: any) { notify("Impossible", e.message); } finally { setBusy(false); }
  };

  return (
    <SheetModal visible={visible} onClose={onClose} title="Mon portefeuille" subtitle="Vos gains et demandes de versement" testID="driver-wallet">
      {loading || !d ? <ActivityIndicator style={{ marginVertical: 24 }} color={theme.color.onSurface} /> : (
        <>
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>Solde disponible</Text>
            <Text style={styles.heroValue} testID="driver-balance">{money(d.balance)}</Text>
          </View>
          <View style={styles.payRow}>
            <TextInput testID="driver-payout-input" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={`Montant (min ${d.min_payout} €)`} placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
            <Pressable testID="driver-payout-btn" onPress={request} disabled={busy} style={[styles.btn, busy && { opacity: 0.5 }]}>{busy ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={styles.btnText}>Demander</Text>}</Pressable>
          </View>

          {d.payouts.length > 0 && <Text style={styles.section}>Versements</Text>}
          {d.payouts.map((p) => { const s = STATUS[p.status] || STATUS.pending; return (
            <View key={p.id} style={styles.line}><Icon name="bank-transfer-out" size={20} color={theme.color.onSurfaceSecondary} /><View style={{ flex: 1 }}><Text style={styles.lineLabel}>Versement</Text><Text style={styles.lineMeta}>{fmtDateTime(p.created_at)}</Text></View><View style={[styles.badge, { backgroundColor: s.color }]}><Text style={styles.badgeText}>{s.label}</Text></View><Text style={styles.amtNeg}>{money(p.amount)}</Text></View>
          ); })}

          <Text style={styles.section}>Historique</Text>
          {d.transactions.length ? d.transactions.map((t) => (
            <View key={t.id} style={styles.line}><Icon name={t.amount >= 0 ? "arrow-down-bold-circle-outline" : "arrow-up-bold-circle-outline"} size={20} color={t.amount >= 0 ? theme.color.success : theme.color.error} /><View style={{ flex: 1 }}><Text style={styles.lineLabel} numberOfLines={1}>{t.label}</Text><Text style={styles.lineMeta}>{fmtDateTime(t.created_at)}</Text></View><Text style={[t.amount >= 0 ? styles.amtPos : styles.amtNeg]}>{t.amount >= 0 ? "+" : ""}{money(t.amount)}</Text></View>
          )) : <Text style={styles.empty}>Aucun mouvement.</Text>}
        </>
      )}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: "#1B2A41", borderRadius: theme.radius.lg, padding: theme.spacing.lg, marginBottom: theme.spacing.md },
  heroLabel: { fontSize: 12, color: "rgba(255,255,255,0.7)" }, heroValue: { fontSize: 32, fontWeight: "800", color: "#fff", marginTop: 2 },
  payRow: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  input: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 48, fontSize: 15, color: theme.color.onSurface },
  btn: { backgroundColor: theme.color.brand, paddingHorizontal: theme.spacing.xl, height: 48, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center" },
  btnText: { color: theme.color.onBrand, fontWeight: "800" },
  section: { fontSize: 13, fontWeight: "800", color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm },
  line: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  lineLabel: { fontSize: 14, fontWeight: "600", color: theme.color.onSurface }, lineMeta: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  amtPos: { fontSize: 15, fontWeight: "800", color: theme.color.success }, amtNeg: { fontSize: 15, fontWeight: "800", color: theme.color.error },
  badge: { paddingHorizontal: 8, height: 22, borderRadius: theme.radius.pill, justifyContent: "center" }, badgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  empty: { fontSize: 13, color: theme.color.onSurfaceTertiary, paddingVertical: theme.spacing.md },
});

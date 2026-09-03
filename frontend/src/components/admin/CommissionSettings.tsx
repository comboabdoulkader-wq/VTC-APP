import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Platform, Alert } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import SheetModal from "@/src/components/ui/SheetModal";

const VEHICLES = ["standard", "premium", "van", "van_premium", "group"];
const VLABEL: Record<string, string> = { standard: "Berline", premium: "Premium", van: "Van", van_premium: "Van premium", group: "Groupe" };
const notify = (t: string, m?: string) => { if (Platform.OS === "web") window.alert(m ? `${t}\n\n${m}` : t); else Alert.alert(t, m); };
const pct = (v: number) => `${Math.round((v || 0) * 100)}`;
const toRate = (s: string) => Math.max(0, Math.min(100, parseFloat(s.replace(",", ".")) || 0)) / 100;

/** Étape 8/9 — configurable commission + cashback engine (per global / per vehicle). */
export default function CommissionSettings({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const [s, setS] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setLoading(true); try { setS(await apiFetch<any>("/admin/settings", {}, token)); } catch { setS(null); } finally { setLoading(false); } }, [token]);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  const save = async () => {
    setBusy(true);
    try {
      await apiFetch("/admin/settings", { method: "PUT", body: JSON.stringify({ commission: s.commission, commission_by_vehicle: s.commission_by_vehicle, cashback: s.cashback }) }, token);
      notify("Enregistré", "Réglages de commission et cashback mis à jour.");
    } catch (e: any) { notify("Erreur", e.message); } finally { setBusy(false); }
  };

  if (!visible) return null;
  return (
    <SheetModal visible={visible} onClose={onClose} title="Commissions & Cashback" subtitle="Configurable globalement et par véhicule" testID="commission-settings"
      footer={<Pressable testID="commission-save" onPress={save} disabled={busy || !s} style={[styles.primary, (busy || !s) && { opacity: 0.5 }]}>{busy ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={styles.primaryText}>Enregistrer</Text>}</Pressable>}>
      {loading || !s ? <ActivityIndicator style={{ marginVertical: 24 }} color={theme.color.onSurface} /> : (
        <>
          <Text style={styles.section}>Commission plateforme</Text>
          <Row label="Commission par défaut (%)" testID="comm-platform" value={pct(s.commission.platform)} onChange={(v) => setS((p: any) => ({ ...p, commission: { ...p.commission, platform: toRate(v) } }))} />
          <Text style={styles.hint}>Appliquée sur chaque course terminée (part plateforme).</Text>

          <Text style={styles.section}>Commission par véhicule (%)</Text>
          {VEHICLES.map((v) => (
            <Row key={v} label={VLABEL[v]} testID={`comm-veh-${v}`} value={s.commission_by_vehicle?.[v] != null ? pct(s.commission_by_vehicle[v]) : ""} placeholder="défaut"
              onChange={(val) => setS((p: any) => { const c = { ...(p.commission_by_vehicle || {}) }; if (!val.trim()) delete c[v]; else c[v] = toRate(val); return { ...p, commission_by_vehicle: c }; })} />
          ))}

          <View style={styles.switchRow}>
            <Text style={styles.section2}>Cashback client</Text>
            <Pressable testID="cashback-toggle" onPress={() => setS((p: any) => ({ ...p, cashback: { ...p.cashback, enabled: !p.cashback.enabled } }))} style={[styles.switch, s.cashback.enabled && styles.switchOn]}><View style={[styles.knob, s.cashback.enabled && styles.knobOn]} /></Pressable>
          </View>
          <Row label="Cashback par défaut (%)" testID="cashback-rate" value={pct(s.cashback.rate)} onChange={(v) => setS((p: any) => ({ ...p, cashback: { ...p.cashback, rate: toRate(v) } }))} />
          <Text style={styles.hint}>Crédité au portefeuille du client à la fin de course. Bonus fidélité : Argent +{pct(s.cashback.tiers.silver)}%, Or +{pct(s.cashback.tiers.gold)}%, Platine +{pct(s.cashback.tiers.platinum)}%.</Text>
          <Text style={styles.subsection}>Cashback par véhicule (%)</Text>
          {VEHICLES.map((v) => (
            <Row key={v} label={VLABEL[v]} testID={`cashback-veh-${v}`} value={s.cashback.by_vehicle?.[v] != null ? pct(s.cashback.by_vehicle[v]) : ""} placeholder="défaut"
              onChange={(val) => setS((p: any) => { const c = { ...(p.cashback.by_vehicle || {}) }; if (!val.trim()) delete c[v]; else c[v] = toRate(val); return { ...p, cashback: { ...p.cashback, by_vehicle: c } }; })} />
          ))}
        </>
      )}
    </SheetModal>
  );
}

const Row = ({ label, value, onChange, testID, placeholder }: any) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <TextInput testID={testID} value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholder={placeholder || "0"} placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
  </View>
);

const styles = StyleSheet.create({
  section: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  section2: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  subsection: { fontSize: 12, fontWeight: "700", color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: theme.spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, marginBottom: theme.spacing.sm },
  rowLabel: { flex: 1, fontSize: 14, color: theme.color.onSurface },
  input: { width: 90, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing.md, height: 44, fontSize: 15, color: theme.color.onSurface, textAlign: "right", fontWeight: "700" },
  hint: { fontSize: 12, color: theme.color.onSurfaceTertiary, lineHeight: 16 },
  switch: { width: 46, height: 28, borderRadius: 14, backgroundColor: theme.color.borderStrong, padding: 3 },
  switchOn: { backgroundColor: theme.color.success },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" }, knobOn: { alignSelf: "flex-end" },
  primary: { backgroundColor: theme.color.brand, height: 52, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  primaryText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 15 },
});

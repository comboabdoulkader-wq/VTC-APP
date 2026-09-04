import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Platform, Alert } from "react-native";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import SheetModal from "@/src/components/ui/SheetModal";

const PRIORITIES = [
  { key: "eta", label: "Temps d'arrivée" }, { key: "distance", label: "Distance" },
  { key: "rating", label: "Meilleure note" }, { key: "fairness", label: "Équité" },
];
const notify = (t: string, m?: string) => { if (Platform.OS === "web") window.alert(m ? `${t}\n\n${m}` : t); else Alert.alert(t, m); };
const num = (s: string, f = 0) => { const n = parseFloat(String(s).replace(",", ".")); return isNaN(n) ? f : n; };

/** Admin "Gestion des Courses": configure intelligent dispatch, alarm and scheduled-ride rules. */
export default function DispatchSettings({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const [s, setS] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setLoading(true); try { const d = await apiFetch<any>("/admin/settings", {}, token); setS(d.dispatch); } catch { setS(null); } finally { setLoading(false); } }, [token]);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  const set = (patch: any) => setS((p: any) => ({ ...p, ...patch }));
  const setAlarm = (patch: any) => setS((p: any) => ({ ...p, alarm: { ...p.alarm, ...patch } }));
  const setPlan = (patch: any) => setS((p: any) => ({ ...p, planning: { ...p.planning, ...patch } }));

  const save = async () => {
    setBusy(true);
    try { await apiFetch("/admin/settings", { method: "PUT", body: JSON.stringify({ dispatch: s }) }, token); notify("Enregistré", "Règles d'attribution mises à jour."); }
    catch (e: any) { notify("Erreur", e.message); } finally { setBusy(false); }
  };

  if (!visible) return null;
  return (
    <SheetModal visible={visible} onClose={onClose} title="Gestion des courses" subtitle="Attribution intelligente, alarme & planning" testID="dispatch-settings"
      footer={<Pressable testID="dispatch-save" onPress={save} disabled={busy || !s} style={[styles.primary, (busy || !s) && { opacity: 0.5 }]}>{busy ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={styles.primaryText}>Enregistrer</Text>}</Pressable>}>
      {loading || !s ? <ActivityIndicator style={{ marginVertical: 24 }} color={theme.color.onSurface} /> : (
        <>
          <Toggle label="Attribution automatique" value={s.enabled} onToggle={() => set({ enabled: !s.enabled })} testID="dispatch-enabled" />
          <Text style={styles.section}>Attribution</Text>
          <Row label="Rayon de recherche (km)" testID="d-radius" value={String(s.radius_km)} onChange={(v: string) => set({ radius_km: num(v, 8) })} />
          <Row label="Chauffeurs sollicités (max)" testID="d-max" value={String(s.max_drivers)} onChange={(v: string) => set({ max_drivers: Math.round(num(v, 8)) })} />
          <Row label="Temps de réponse (s)" testID="d-resp" value={String(s.response_seconds)} onChange={(v: string) => set({ response_seconds: Math.round(num(v, 15)) })} />
          <Text style={styles.fieldLabel}>Priorité</Text>
          <View style={styles.chips}>
            {PRIORITIES.map((p) => (
              <Pressable key={p.key} testID={`d-prio-${p.key}`} onPress={() => set({ priority: p.key })} style={[styles.chip, s.priority === p.key && styles.chipOn]}>
                <Text style={[styles.chipText, s.priority === p.key && { color: theme.color.onBrand }]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>Alarme chauffeur</Text>
          <Toggle label="Activer l'alarme" value={s.alarm.enabled} onToggle={() => setAlarm({ enabled: !s.alarm.enabled })} testID="d-alarm-enabled" />
          <Row label="Durée sonnerie (s)" testID="d-alarm-duration" value={String(s.alarm.duration_seconds)} onChange={(v: string) => setAlarm({ duration_seconds: Math.round(num(v, 30)) })} />
          <Row label="Répétitions" testID="d-alarm-repeats" value={String(s.alarm.repeats)} onChange={(v: string) => setAlarm({ repeats: Math.round(num(v, 3)) })} />

          <Text style={styles.section}>Courses programmées</Text>
          <Toggle label="Autoriser la programmation" value={s.planning.allow_scheduled} onToggle={() => setPlan({ allow_scheduled: !s.planning.allow_scheduled })} testID="d-plan-allow" />
          <Row label="Délai minimal (min)" testID="d-plan-min" value={String(s.planning.min_lead_minutes)} onChange={(v: string) => setPlan({ min_lead_minutes: Math.round(num(v, 30)) })} />
          <Row label="Délai maximal (jours)" testID="d-plan-max" value={String(s.planning.max_lead_days)} onChange={(v: string) => setPlan({ max_lead_days: Math.round(num(v, 30)) })} />
        </>
      )}
    </SheetModal>
  );
}

const Toggle = ({ label, value, onToggle, testID }: any) => (
  <Pressable testID={testID} onPress={onToggle} style={styles.switchRow}>
    <Text style={styles.switchLabel}>{label}</Text>
    <View style={[styles.switch, value && styles.switchOn]}><View style={[styles.knob, value && styles.knobOn]} /></View>
  </Pressable>
);
const Row = ({ label, value, onChange, testID }: any) => (
  <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text>
    <TextInput testID={testID} value={value} onChangeText={onChange} keyboardType="decimal-pad" style={styles.input} placeholderTextColor={theme.color.onSurfaceTertiary} /></View>
);

const styles = StyleSheet.create({
  section: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, marginBottom: theme.spacing.sm },
  rowLabel: { flex: 1, fontSize: 14, color: theme.color.onSurface },
  input: { width: 90, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing.md, height: 44, fontSize: 15, color: theme.color.onSurface, textAlign: "right", fontWeight: "700" },
  fieldLabel: { fontSize: 12, color: theme.color.onSurfaceSecondary, fontWeight: "600", marginTop: theme.spacing.sm, marginBottom: theme.spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  chip: { paddingHorizontal: theme.spacing.md, height: 38, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, justifyContent: "center" },
  chipOn: { backgroundColor: theme.color.brand }, chipText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: theme.spacing.sm },
  switchLabel: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  switch: { width: 46, height: 28, borderRadius: 14, backgroundColor: theme.color.borderStrong, padding: 3 },
  switchOn: { backgroundColor: theme.color.success },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" }, knobOn: { alignSelf: "flex-end" },
  primary: { backgroundColor: theme.color.brand, height: 52, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  primaryText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 15 },
});

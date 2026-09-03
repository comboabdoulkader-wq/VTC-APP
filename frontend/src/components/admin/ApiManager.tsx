import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, ScrollView, Platform, Alert } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import SheetModal from "@/src/components/ui/SheetModal";

type FieldDef = { name: string; label: string; secret?: boolean; value: string; set: boolean };
type Provider = { key: string; label: string; enabled: boolean; mode: string; fields: FieldDef[]; test_ok?: boolean; test_message?: string };
type Category = { category: string; label: string; modes: boolean; active: number; total: number; providers: Provider[] };

const CAT_ICON: Record<string, string> = {
  payment: "credit-card-outline", sms: "message-text-outline", email: "email-outline", maps: "map-outline",
  push: "bell-outline", auth: "shield-account-outline", ai: "robot-outline", monitoring: "chart-line", storage: "cloud-outline",
};

const notify = (title: string, msg?: string) => { if (Platform.OS === "web") window.alert(msg ? `${title}\n\n${msg}` : title); else Alert.alert(title, msg); };

/** Étape 6 — secure Admin API console. Enable/disable + configure every provider; all OFF by default. */
export default function ApiManager({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const [cats, setCats] = useState<Category[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await apiFetch<{ categories: Category[]; enabled_total: number }>("/admin/integrations", {}, token); setCats(d.categories); setTotal(d.enabled_total); }
    catch { setCats([]); } finally { setLoading(false); }
  }, [token]);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  const expand = (p: Provider) => {
    if (open === p.key) { setOpen(null); return; }
    setOpen(p.key);
    setDraft({ enabled: p.enabled, mode: p.mode, fields: Object.fromEntries(p.fields.map((f) => [f.name, f.secret && f.set ? f.value : f.value])) });
  };

  const save = async (p: Provider) => {
    setBusy(p.key);
    try {
      // Skip resubmitting masked secrets (value still contains •) so we don't overwrite stored keys.
      const fields = Object.fromEntries(Object.entries(draft.fields || {}).filter(([k, v]) => !(String(v).includes("•"))));
      await apiFetch(`/admin/integrations/${p.key}`, { method: "PUT", body: JSON.stringify({ enabled: draft.enabled, mode: draft.mode, fields }) }, token);
      await load();
      notify("Enregistré", `${p.label} mis à jour.`);
    } catch (e: any) { notify("Erreur", e.message); } finally { setBusy(null); }
  };

  const test = async (p: Provider) => {
    setBusy(p.key + "-test");
    try { const r = await apiFetch<{ ok: boolean; message: string }>(`/admin/integrations/${p.key}/test`, { method: "POST" }, token); notify(r.ok ? "Connexion OK" : "Test échoué", r.message); load(); }
    catch (e: any) { notify("Erreur", e.message); } finally { setBusy(null); }
  };

  return (
    <SheetModal visible={visible} onClose={onClose} title="Gestion des API" subtitle={`${total} fournisseur(s) actif(s) · tout est désactivé par défaut`} testID="api-manager">
      {loading ? <ActivityIndicator style={{ marginVertical: 24 }} color={theme.color.onSurface} /> : cats.map((c) => (
        <View key={c.category} style={{ marginBottom: theme.spacing.lg }}>
          <View style={styles.catHead}>
            <Icon name={(CAT_ICON[c.category] || "api") as any} size={18} color={theme.color.onSurface} />
            <Text style={styles.catLabel}>{c.label}</Text>
            <View style={styles.countPill}><Text style={styles.countText}>{c.active}/{c.total}</Text></View>
          </View>
          {c.providers.map((p) => {
            const isOpen = open === p.key;
            return (
              <View key={p.key} style={styles.provCard} testID={`api-${p.key}`}>
                <Pressable onPress={() => expand(p)} style={styles.provHead} testID={`api-toggle-${p.key}`}>
                  <View style={[styles.statusDot, { backgroundColor: p.enabled ? theme.color.success : theme.color.borderStrong }]} />
                  <Text style={styles.provLabel}>{p.label}</Text>
                  {p.enabled ? <Text style={styles.modeTag}>{p.mode === "production" ? "PROD" : "SANDBOX"}</Text> : null}
                  <Icon name={isOpen ? "chevron-up" : "chevron-down"} size={20} color={theme.color.onSurfaceTertiary} />
                </Pressable>
                {isOpen && (
                  <View style={styles.provBody}>
                    <Pressable testID={`api-enable-${p.key}`} onPress={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))} style={styles.switchRow}>
                      <Text style={styles.switchLabel}>Activer</Text>
                      <View style={[styles.switch, draft.enabled && styles.switchOn]}><View style={[styles.knob, draft.enabled && styles.knobOn]} /></View>
                    </Pressable>
                    {c.modes && (
                      <View style={styles.segment}>
                        {["sandbox", "production"].map((m) => (
                          <Pressable key={m} testID={`api-mode-${p.key}-${m}`} onPress={() => setDraft((d) => ({ ...d, mode: m }))} style={[styles.seg, draft.mode === m && styles.segActive]}>
                            <Text style={[styles.segText, draft.mode === m && { color: theme.color.onBrand }]}>{m === "sandbox" ? "Sandbox" : "Production"}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    {p.fields.map((f) => (
                      <View key={f.name} style={{ marginTop: theme.spacing.sm }}>
                        <Text style={styles.fieldLabel}>{f.label}{f.secret ? " 🔒" : ""}</Text>
                        <TextInput testID={`api-field-${p.key}-${f.name}`} value={draft.fields?.[f.name] ?? ""} onChangeText={(v) => setDraft((d) => ({ ...d, fields: { ...d.fields, [f.name]: v } }))}
                          secureTextEntry={false} autoCapitalize="none" autoCorrect={false} placeholder={f.set ? "Déjà configuré" : f.label} placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
                      </View>
                    ))}
                    {p.fields.length === 0 ? <Text style={styles.noFields}>Aucune clé requise.</Text> : null}
                    {p.test_message ? <Text style={[styles.testMsg, { color: p.test_ok ? theme.color.success : theme.color.error }]}>{p.test_ok ? "✓ " : "⚠ "}{p.test_message}</Text> : null}
                    <View style={styles.actions}>
                      <Pressable testID={`api-test-${p.key}`} onPress={() => test(p)} disabled={busy === p.key + "-test"} style={[styles.btn, styles.testBtn]}>{busy === p.key + "-test" ? <ActivityIndicator color={theme.color.onSurface} /> : <Text style={styles.testBtnText}>Tester</Text>}</Pressable>
                      <Pressable testID={`api-save-${p.key}`} onPress={() => save(p)} disabled={busy === p.key} style={[styles.btn, styles.saveBtn]}>{busy === p.key ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={styles.saveBtnText}>Enregistrer</Text>}</Pressable>
                    </View>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  catHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  catLabel: { flex: 1, fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  countPill: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  countText: { fontSize: 12, fontWeight: "800", color: theme.color.onSurfaceSecondary },
  provCard: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, marginBottom: theme.spacing.sm, overflow: "hidden" },
  provHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md, height: 52 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  provLabel: { flex: 1, fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  modeTag: { fontSize: 10, fontWeight: "800", color: theme.color.onSurfaceSecondary, backgroundColor: theme.color.surface, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  provBody: { paddingHorizontal: theme.spacing.md, paddingBottom: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.color.border },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: theme.spacing.md },
  switchLabel: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  switch: { width: 46, height: 28, borderRadius: 14, backgroundColor: theme.color.borderStrong, padding: 3 },
  switchOn: { backgroundColor: theme.color.success },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
  segment: { flexDirection: "row", backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: 3, marginBottom: theme.spacing.sm },
  seg: { flex: 1, height: 34, borderRadius: theme.radius.sm, alignItems: "center", justifyContent: "center" },
  segActive: { backgroundColor: theme.color.brand },
  segText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  fieldLabel: { fontSize: 12, color: theme.color.onSurfaceSecondary, fontWeight: "600", marginBottom: 4 },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing.md, height: 44, fontSize: 14, color: theme.color.onSurface, borderWidth: 1, borderColor: theme.color.border },
  noFields: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.sm },
  testMsg: { fontSize: 12, marginTop: theme.spacing.sm, fontWeight: "600" },
  actions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
  btn: { flex: 1, height: 44, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center" },
  testBtn: { borderWidth: 1, borderColor: theme.color.borderStrong }, testBtnText: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  saveBtn: { backgroundColor: theme.color.brand }, saveBtnText: { fontSize: 14, fontWeight: "800", color: theme.color.onBrand },
});

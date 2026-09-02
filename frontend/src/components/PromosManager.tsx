import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Switch, Alert } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import SheetModal from "@/src/components/ui/SheetModal";
import { apiFetch, useAuth } from "@/src/context/auth";

type Promo = { id: string; code: string; kind: "percent" | "amount"; value: number; max_uses?: number | null; uses: number; expires_at?: string | null; active: boolean; company_id?: string | null };

/** Promo codes management for companies (employee rides) and admins (platform-wide). */
export default function PromosManager({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { token, user } = useAuth();
  const [list, setList] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => { try { setList(await apiFetch<Promo[]>("/promos", {}, token)); } catch {} finally { setLoading(false); } }, [token]);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  const create = async () => {
    const v = parseFloat(value.replace(",", "."));
    if (code.trim().length < 3 || !v || v <= 0) { Alert.alert("Champs invalides", "Code (3 caractères min.) et valeur requis"); return; }
    setSaving(true);
    try {
      await apiFetch("/promos", { method: "POST", body: JSON.stringify({ code: code.trim(), kind, value: v, max_uses: maxUses ? parseInt(maxUses, 10) : null }) }, token);
      setCode(""); setValue(""); setMaxUses(""); load();
    } catch (e: any) { Alert.alert("Erreur", e.message); } finally { setSaving(false); }
  };
  const toggle = async (p: Promo, active: boolean) => { try { await apiFetch(`/promos/${p.id}`, { method: "PATCH", body: JSON.stringify({ active }) }, token); load(); } catch {} };
  const remove = (p: Promo) => Alert.alert("Supprimer", `Supprimer le code ${p.code} ?`, [{ text: "Annuler", style: "cancel" }, { text: "Supprimer", style: "destructive", onPress: async () => { await apiFetch(`/promos/${p.id}`, { method: "DELETE" }, token); load(); } }]);

  return (
    <SheetModal visible={visible} onClose={onClose} title="Codes promo" subtitle={user?.role === "company" ? "Réductions pour les déplacements pro de vos employés" : "Réductions plateforme (tous les passagers)"} testID="promos-manager">
      <View style={styles.form}>
        <TextInput testID="promo-code" value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="CODE (ex. BIENVENUE10)" autoCapitalize="characters" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
        <View style={styles.row}>
          <Pressable testID="promo-kind-percent" onPress={() => setKind("percent")} style={[styles.chip, kind === "percent" && styles.chipActive]}><Text style={[styles.chipText, kind === "percent" && { color: "#fff" }]}>% réduction</Text></Pressable>
          <Pressable testID="promo-kind-amount" onPress={() => setKind("amount")} style={[styles.chip, kind === "amount" && styles.chipActive]}><Text style={[styles.chipText, kind === "amount" && { color: "#fff" }]}>€ fixe</Text></Pressable>
        </View>
        <View style={styles.row}>
          <TextInput testID="promo-value" value={value} onChangeText={setValue} placeholder={kind === "percent" ? "Ex. 10" : "Ex. 5"} keyboardType="decimal-pad" placeholderTextColor={theme.color.onSurfaceTertiary} style={[styles.input, { flex: 1 }]} />
          <TextInput testID="promo-max" value={maxUses} onChangeText={setMaxUses} placeholder="Utilisations max" keyboardType="number-pad" placeholderTextColor={theme.color.onSurfaceTertiary} style={[styles.input, { flex: 1 }]} />
        </View>
        <Pressable testID="promo-create" onPress={create} disabled={saving} style={styles.btn}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Créer le code</Text>}</Pressable>
      </View>
      {loading ? <ActivityIndicator color={theme.color.onSurface} /> : list.length === 0 ? <Text style={styles.meta}>Aucun code pour l'instant</Text> : list.map((p) => (
        <View key={p.id} style={styles.promoRow} testID={`promo-${p.id}`}>
          <View style={{ flex: 1 }}>
            <Text style={styles.code}>{p.code}</Text>
            <Text style={styles.meta}>{p.kind === "percent" ? `-${p.value} %` : `-${p.value.toFixed(2)} €`} · {p.uses}{p.max_uses ? `/${p.max_uses}` : ""} utilisation(s)</Text>
          </View>
          <Switch testID={`promo-active-${p.id}`} value={p.active} onValueChange={(v) => toggle(p, v)} trackColor={{ true: theme.color.success, false: theme.color.borderStrong }} thumbColor="#fff" />
          <Pressable testID={`promo-delete-${p.id}`} onPress={() => remove(p)} hitSlop={8}><Icon name="trash-can-outline" size={20} color={theme.color.error} /></Pressable>
        </View>
      ))}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  form: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.lg, gap: theme.spacing.sm },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 46, fontSize: 15, color: theme.color.onSurface },
  row: { flexDirection: "row", gap: theme.spacing.sm },
  chip: { flex: 1, height: 40, borderRadius: theme.radius.pill, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: theme.color.brand },
  chipText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  btn: { backgroundColor: theme.color.brand, height: 46, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "800" },
  promoRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  code: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, letterSpacing: 1 },
  meta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
});

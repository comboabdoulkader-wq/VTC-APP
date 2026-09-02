import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import SheetModal from "@/src/components/ui/SheetModal";
import { apiFetch, useAuth } from "@/src/context/auth";

type City = { id: string; name: string; country?: string | null; lat: number; lng: number; source: string };

/** Moderator tool: list / edit / add city centers used for the distance surcharge worldwide. */
export default function CitiesModeration({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const [cities, setCities] = useState<City[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Partial<City> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setCities(await apiFetch<City[]>("/admin/cities", {}, token)); } catch {} finally { setLoading(false); }
  }, [token]);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  const save = async () => {
    if (!editing?.name || editing.lat == null || editing.lng == null || isNaN(Number(editing.lat)) || isNaN(Number(editing.lng))) { Alert.alert("Champs invalides", "Nom, latitude et longitude sont requis"); return; }
    setSaving(true);
    try {
      const body = { name: editing.name, country: editing.country || null, lat: Number(editing.lat), lng: Number(editing.lng) };
      if (editing.id) await apiFetch(`/admin/cities/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) }, token);
      else await apiFetch("/admin/cities", { method: "POST", body: JSON.stringify(body) }, token);
      setEditing(null); load();
    } catch (e: any) { Alert.alert("Erreur", e.message); } finally { setSaving(false); }
  };

  const list = cities.filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase()) || (c.country || "").toLowerCase().includes(filter.toLowerCase()));

  return (
    <SheetModal visible={visible} onClose={onClose} title="Centres-villes" subtitle="Référence pour la rallonge 1,20 €/km · monde entier" testID="cities-moderation">
      <View style={styles.row}>
        <TextInput testID="city-filter" value={filter} onChangeText={setFilter} placeholder="Rechercher une ville" placeholderTextColor={theme.color.onSurfaceTertiary} style={[styles.input, { flex: 1 }]} />
        <Pressable testID="city-add" onPress={() => setEditing({ name: "", country: "", lat: undefined, lng: undefined })} style={styles.addBtn}><Icon name="plus" size={22} color="#fff" /></Pressable>
      </View>

      {editing && (
        <View style={styles.editor} testID="city-editor">
          <Text style={styles.editorTitle}>{editing.id ? `Modifier ${editing.name}` : "Nouvelle ville"}</Text>
          <TextInput testID="city-name" value={editing.name || ""} onChangeText={(t) => setEditing({ ...editing, name: t })} placeholder="Nom" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
          <TextInput testID="city-country" value={editing.country || ""} onChangeText={(t) => setEditing({ ...editing, country: t })} placeholder="Pays" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
          <View style={styles.row}>
            <TextInput testID="city-lat" value={editing.lat == null ? "" : String(editing.lat)} onChangeText={(t) => setEditing({ ...editing, lat: t as any })} placeholder="Latitude" keyboardType="numeric" placeholderTextColor={theme.color.onSurfaceTertiary} style={[styles.input, { flex: 1 }]} />
            <TextInput testID="city-lng" value={editing.lng == null ? "" : String(editing.lng)} onChangeText={(t) => setEditing({ ...editing, lng: t as any })} placeholder="Longitude" keyboardType="numeric" placeholderTextColor={theme.color.onSurfaceTertiary} style={[styles.input, { flex: 1 }]} />
          </View>
          <View style={styles.row}>
            <Pressable onPress={() => setEditing(null)} style={styles.ghost}><Text style={styles.ghostText}>Annuler</Text></Pressable>
            <Pressable testID="city-save" onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Enregistrer</Text>}</Pressable>
          </View>
        </View>
      )}

      {loading ? <ActivityIndicator color={theme.color.onSurface} /> : list.map((c) => (
        <Pressable key={c.id} testID={`city-${c.id}`} onPress={() => setEditing(c)} style={styles.city}>
          <Icon name="city-variant-outline" size={20} color={theme.color.onSurfaceSecondary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.cityName}>{c.name}{c.country ? `, ${c.country}` : ""}</Text>
            <Text style={styles.cityMeta}>{c.lat.toFixed(4)}, {c.lng.toFixed(4)} · {c.source === "auto" ? "détectée automatiquement" : c.source === "moderator" ? "modifiée par un modérateur" : "par défaut"}</Text>
          </View>
          <Icon name="pencil-outline" size={18} color={theme.color.onSurfaceTertiary} />
        </Pressable>
      ))}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: theme.spacing.sm, alignItems: "center", marginBottom: theme.spacing.sm },
  input: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 46, fontSize: 15, color: theme.color.onSurface, marginBottom: theme.spacing.sm },
  addBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.sm },
  editor: { backgroundColor: "#FFF7ED", borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.md, borderWidth: 1, borderColor: "#FED7AA" },
  editorTitle: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface, marginBottom: theme.spacing.sm },
  ghost: { flex: 1, height: 44, alignItems: "center", justifyContent: "center" },
  ghostText: { fontWeight: "700", color: theme.color.onSurfaceSecondary },
  saveBtn: { flex: 1, height: 44, borderRadius: theme.radius.pill, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center" },
  saveText: { color: "#fff", fontWeight: "800" },
  city: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  cityName: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  cityMeta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
});

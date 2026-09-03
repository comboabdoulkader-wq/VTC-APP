import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Alert, ActivityIndicator, Image, Switch, Platform } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import SheetModal from "@/src/components/ui/SheetModal";
import { pickImage } from "@/src/utils/files";
import { money } from "@/src/utils/format";

const API = process.env.EXPO_PUBLIC_BACKEND_URL;
type Zone = { name: string; lat: number; lng: number; radius_km: number };
type Route = { id: string; name: string; from_zone: Zone; to_zone: Zone; prices: Record<string, number>; active: boolean };
type Vehicle = { key: string; label: string; image_url: string; custom_photo: boolean; passengers: number; luggage: number };
const EMPTY_ZONE: Zone = { name: "", lat: 48.8566, lng: 2.3522, radius_km: 3 };

/** Moderator console: fixed-price routes (create / edit prices / toggle / delete) and vehicle category photos. */
export default function CatalogAdmin({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const [tab, setTab] = useState<"routes" | "vehicles">("routes");
  const [routes, setRoutes] = useState<Route[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [editing, setEditing] = useState<Route | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([apiFetch<Route[]>("/fixed-routes?all=true", {}, token), apiFetch<any>("/catalog")]);
      setRoutes(r); setVehicles(c.vehicles);
    } catch (e: any) { Alert.alert("Erreur", e.message); }
  }, [token]);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  const newRoute = () => setEditing({ id: "", name: "", from_zone: { ...EMPTY_ZONE }, to_zone: { ...EMPTY_ZONE, name: "" }, prices: Object.fromEntries(vehicles.map((v) => [v.key, 0])), active: true });

  const save = async () => {
    if (!editing) return;
    const prices = Object.fromEntries(Object.entries(editing.prices).filter(([, p]) => Number(p) > 0).map(([k, p]) => [k, Number(p)]));
    if (!editing.from_zone.name.trim() || !editing.to_zone.name.trim() || !Object.keys(prices).length) { Alert.alert("Champs requis", "Nom des deux zones et au moins un prix."); return; }
    const body = { ...editing, name: editing.name.trim() || `${editing.from_zone.name} → ${editing.to_zone.name}`, prices };
    setBusy(true);
    try {
      await apiFetch(editing.id ? `/admin/fixed-routes/${editing.id}` : "/admin/fixed-routes", { method: editing.id ? "PATCH" : "POST", body: JSON.stringify({ ...body, id: undefined }) }, token);
      setEditing(null); await load();
    } catch (e: any) { Alert.alert("Erreur", e.message); } finally { setBusy(false); }
  };

  const toggle = async (r: Route) => { try { await apiFetch(`/admin/fixed-routes/${r.id}`, { method: "PATCH", body: JSON.stringify({ ...r, id: undefined, active: !r.active }) }, token); load(); } catch (e: any) { Alert.alert("Erreur", e.message); } };
  const doRemove = async (r: Route) => { try { await apiFetch(`/admin/fixed-routes/${r.id}`, { method: "DELETE" }, token); load(); } catch (e: any) { Alert.alert("Erreur", e.message); } };
  const remove = (r: Route) => {
    if (Platform.OS === "web") { if (typeof window !== "undefined" && window.confirm(`Supprimer « ${r.name} » ?`)) doRemove(r); return; }
    Alert.alert("Supprimer", `Supprimer « ${r.name} » ?`, [{ text: "Annuler", style: "cancel" }, { text: "Supprimer", style: "destructive", onPress: () => doRemove(r) }]);
  };

  const uploadPhoto = async (v: Vehicle) => {
    const asset = await pickImage("library");
    if (!asset) return;
    setBusy(true);
    try {
      const form = new FormData();
      const name = asset.fileName || `${v.key}.jpg`;
      if (Platform.OS === "web") form.append("file", await (await fetch(asset.uri)).blob(), name);
      else form.append("file", { uri: asset.uri, name, type: asset.mimeType || "image/jpeg" } as any);
      const res = await fetch(`${API}/api/admin/vehicles/${v.key}/photo`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || `Erreur ${res.status}`);
      await load();
    } catch (e: any) { Alert.alert("Erreur", e.message); } finally { setBusy(false); }
  };
  const resetPhoto = async (v: Vehicle) => { try { await apiFetch(`/admin/vehicles/${v.key}/photo`, { method: "DELETE" }, token); load(); } catch (e: any) { Alert.alert("Erreur", e.message); } };

  return (
    <SheetModal visible={visible} onClose={() => { setEditing(null); onClose(); }} title="Grille tarifaire & véhicules" subtitle="Trajets à prix fixe et photos des catégories" testID="catalog-admin">
      <View style={styles.tabs}>
        {(["routes", "vehicles"] as const).map((k) => (
          <Pressable key={k} testID={`admin-tab-${k}`} onPress={() => { setTab(k); setEditing(null); }} style={[styles.tab, tab === k && styles.tabActive]}>
            <Text style={[styles.tabText, tab === k && { color: theme.color.onBrand }]}>{k === "routes" ? `Prix fixes (${routes.length})` : "Photos véhicules"}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "routes" && !editing && (
        <>
          <Pressable testID="route-new" onPress={newRoute} style={styles.addBtn}><Icon name="plus" size={18} color={theme.color.onBrand} /><Text style={styles.addText}>Nouveau trajet à prix fixe</Text></Pressable>
          {routes.map((r) => (
            <View key={r.id} style={[styles.route, !r.active && { opacity: 0.55 }]} testID={`route-${r.id}`}>
              <Pressable style={{ flex: 1 }} onPress={() => setEditing({ ...r, prices: { ...r.prices } })} testID={`route-edit-${r.id}`}>
                <Text style={styles.routeName}>{r.name}</Text>
                <Text style={styles.routeMeta}>{Object.entries(r.prices).map(([k, p]) => `${vehicles.find((v) => v.key === k)?.label || k} ${money(p)}`).join(" · ")}</Text>
                <Text style={styles.routeMeta}>Rayons {r.from_zone.radius_km} km → {r.to_zone.radius_km} km</Text>
              </Pressable>
              <Switch testID={`route-active-${r.id}`} value={r.active} onValueChange={() => toggle(r)} trackColor={{ true: theme.color.success, false: theme.color.borderStrong }} thumbColor="#fff" />
              <Pressable testID={`route-delete-${r.id}`} onPress={() => remove(r)} hitSlop={8}><Icon name="trash-can-outline" size={20} color={theme.color.error} /></Pressable>
            </View>
          ))}
        </>
      )}

      {tab === "routes" && editing && (
        <View testID="route-form">
          <Text style={styles.label}>Nom (optionnel)</Text>
          <TextInput testID="route-name" value={editing.name} onChangeText={(t) => setEditing({ ...editing, name: t })} placeholder="CDG → Paris Centre" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
          {(["from_zone", "to_zone"] as const).map((zk) => (
            <View key={zk} style={styles.zone}>
              <Text style={styles.zoneTitle}>{zk === "from_zone" ? "Zone de départ" : "Zone d'arrivée"}</Text>
              <TextInput testID={`${zk}-name`} value={editing[zk].name} onChangeText={(t) => setEditing({ ...editing, [zk]: { ...editing[zk], name: t } })} placeholder="Nom (Aéroport d'Orly)" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
              <View style={styles.row3}>
                {(["lat", "lng", "radius_km"] as const).map((f) => (
                  <View key={f} style={{ flex: 1 }}>
                    <Text style={styles.small}>{f === "radius_km" ? "Rayon km" : f === "lat" ? "Latitude" : "Longitude"}</Text>
                    <TextInput testID={`${zk}-${f}`} value={String(editing[zk][f])} keyboardType="decimal-pad" onChangeText={(t) => setEditing({ ...editing, [zk]: { ...editing[zk], [f]: Number(t.replace(",", ".")) || 0 } })} style={styles.input} />
                  </View>
                ))}
              </View>
            </View>
          ))}
          <Text style={styles.label}>Prix TTC par catégorie (0 = non proposé)</Text>
          {vehicles.map((v) => (
            <View key={v.key} style={styles.priceRow}>
              <Text style={styles.priceLabel}>{v.label}</Text>
              <TextInput testID={`price-${v.key}`} value={String(editing.prices[v.key] ?? 0)} keyboardType="decimal-pad" onChangeText={(t) => setEditing({ ...editing, prices: { ...editing.prices, [v.key]: Number(t.replace(",", ".")) || 0 } })} style={[styles.input, { width: 96, textAlign: "right" }]} />
              <Text style={styles.priceLabel}>€</Text>
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md }}>
            <Pressable testID="route-cancel" onPress={() => setEditing(null)} style={[styles.btn, styles.btnGhost]}><Text style={styles.btnGhostText}>Annuler</Text></Pressable>
            <Pressable testID="route-save" onPress={save} disabled={busy} style={[styles.btn, busy && { opacity: 0.6 }]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Enregistrer</Text>}</Pressable>
          </View>
        </View>
      )}

      {tab === "vehicles" && vehicles.map((v) => (
        <View key={v.key} style={styles.vehicle} testID={`vehicle-admin-${v.key}`}>
          <View style={styles.thumb}>{v.image_url ? <Image source={{ uri: v.image_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : <Icon name="car" size={28} color={theme.color.onSurfaceTertiary} />}</View>
          <View style={{ flex: 1 }}>
            <Text style={styles.routeName}>{v.label}</Text>
            <Text style={styles.routeMeta}>{v.passengers} pass. · {v.luggage} bagages · {v.custom_photo ? "Photo personnalisée" : v.image_url ? "Photo par défaut" : "Aucune photo (icône)"}</Text>
          </View>
          <Pressable testID={`vehicle-photo-${v.key}`} onPress={() => uploadPhoto(v)} disabled={busy} style={styles.iconBtn}><Icon name="camera-plus-outline" size={22} color={theme.color.onSurface} /></Pressable>
          {v.custom_photo ? <Pressable testID={`vehicle-photo-reset-${v.key}`} onPress={() => resetPhoto(v)} style={styles.iconBtn}><Icon name="restore" size={22} color={theme.color.error} /></Pressable> : null}
        </View>
      ))}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, padding: 4, marginBottom: theme.spacing.lg },
  tab: { flex: 1, height: 40, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  tabActive: { backgroundColor: theme.color.brand },
  tabText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, borderRadius: theme.radius.pill, backgroundColor: theme.color.brand, marginBottom: theme.spacing.md },
  addText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 14 },
  route: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm },
  routeName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  routeMeta: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  label: { fontSize: 13, fontWeight: "700", color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.md, marginBottom: 6 },
  small: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginBottom: 4 },
  input: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing.md, height: 44, fontSize: 14, color: theme.color.onSurface, marginBottom: theme.spacing.sm },
  zone: { backgroundColor: theme.color.surface, borderWidth: 1, borderColor: theme.color.border, borderRadius: theme.radius.md, padding: theme.spacing.md, marginTop: theme.spacing.md },
  zoneTitle: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface, marginBottom: theme.spacing.sm },
  row3: { flexDirection: "row", gap: theme.spacing.sm },
  priceRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  priceLabel: { flex: 1, fontSize: 14, color: theme.color.onSurface },
  btn: { flex: 1, height: 48, borderRadius: theme.radius.pill, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center" },
  btnText: { color: theme.color.onBrand, fontWeight: "800" },
  btnGhost: { backgroundColor: theme.color.surfaceSecondary },
  btnGhostText: { color: theme.color.onSurface, fontWeight: "700" },
  vehicle: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm },
  thumb: { width: 72, height: 48, borderRadius: theme.radius.sm, backgroundColor: theme.color.surface, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
});

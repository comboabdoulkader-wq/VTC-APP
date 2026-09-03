import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, ScrollView } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import SheetModal from "@/src/components/ui/SheetModal";
import DateTimeChips from "@/src/components/ui/DateTimeChips";
import { useAddressSearch } from "@/src/hooks/useAddressSearch";
import { Place } from "@/src/data/places";
import { money } from "@/src/utils/format";

type Pt = { lat: number; lng: number; address: string };
type Props = { visible: boolean; onClose: () => void; ride: any; onSaved: () => void };

/** Passenger edits a ride (destination, stops, vehicle, date, pax/bags) with a live recomputed price. */
export default function RideEditSheet({ visible, onClose, ride, onSaved }: Props) {
  const { token } = useAuth();
  const [dropoff, setDropoff] = useState<Pt>(ride.dropoff);
  const [stops, setStops] = useState<Pt[]>(ride.stops || []);
  const [vehicle, setVehicle] = useState<string>(ride.vehicle_type);
  const [when, setWhen] = useState<Date | null>(ride.scheduled_at ? new Date(ride.scheduled_at) : null);
  const [pax, setPax] = useState(ride.passengers || 1);
  const [bags, setBags] = useState(ride.luggage || 0);
  const [options, setOptions] = useState<any[]>([]);
  const [editing, setEditing] = useState<"dropoff" | number | null>(null);
  const [query, setQuery] = useState("");
  const { results, searching } = useAddressSearch(query, ride.pickup ? { lat: ride.pickup.lat, lng: ride.pickup.lng } : null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (visible) { setDropoff(ride.dropoff); setStops(ride.stops || []); setVehicle(ride.vehicle_type); setWhen(ride.scheduled_at ? new Date(ride.scheduled_at) : null); setPax(ride.passengers || 1); setBags(ride.luggage || 0); setError(null); setEditing(null); setQuery(""); } }, [visible]);

  useEffect(() => {
    if (!visible) return;
    apiFetch<{ options: any[] }>("/rides/estimate", { method: "POST", body: JSON.stringify({ pickup: ride.pickup, dropoff, stops, passengers: pax, luggage: bags, service_type: ride.service_type }) }, token)
      .then((r) => setOptions(r.options)).catch(() => {});
  }, [visible, dropoff, stops, pax, bags]);

  const pick = (p: Place) => { const pt = { lat: p.lat, lng: p.lng, address: p.address }; if (editing === "dropoff") setDropoff(pt); else if (typeof editing === "number") setStops((s) => s.map((x, i) => (i === editing ? pt : x))); setEditing(null); setQuery(""); };
  const addStop = () => setStops((s) => [...s, { lat: ride.pickup.lat, lng: ride.pickup.lng, address: "" }].map((x, i, a) => (i === a.length - 1 ? x : x)));
  const removeStop = (i: number) => setStops((s) => s.filter((_, idx) => idx !== i));
  const move = (i: number, d: number) => setStops((s) => { const a = [...s]; const j = i + d; if (j < 0 || j >= a.length) return s; [a[i], a[j]] = [a[j], a[i]]; return a; });

  const selected = options.find((o) => o.vehicle_type === vehicle);

  const save = async () => {
    setError(null);
    if (stops.some((s) => !s.address)) { setError("Renseignez l'adresse de chaque arrêt"); return; }
    setBusy(true);
    try {
      await apiFetch(`/rides/${ride.id}`, { method: "PATCH", body: JSON.stringify({ dropoff, stops, vehicle_type: vehicle, scheduled_at: when ? when.toISOString() : null, passengers: pax, luggage: bags }) }, token);
      onSaved(); onClose();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <SheetModal visible={visible} onClose={onClose} title="Modifier la course" subtitle="Le prix est recalculé avant validation" testID="ride-edit"
      footer={<Pressable testID="ride-edit-save" onPress={save} disabled={busy || !selected} style={[styles.primary, (busy || !selected) && { opacity: 0.5 }]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Confirmer{selected ? ` • ${money(selected.price)}` : ""}</Text>}</Pressable>}>
      {editing !== null ? (
        <View>
          <Text style={styles.label}>{editing === "dropoff" ? "Nouvelle destination" : "Adresse de l'arrêt"}</Text>
          <TextInput testID="edit-address-input" autoFocus value={query} onChangeText={setQuery} placeholder="Adresse, aéroport, gare…" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
          {searching ? <ActivityIndicator style={{ marginTop: 12 }} color={theme.color.onSurface} /> : results.map((p) => (
            <Pressable key={p.id} testID={`edit-place-${p.id}`} onPress={() => pick(p)} style={styles.place}><Icon name="map-marker-outline" size={20} color={theme.color.onSurfaceSecondary} /><View style={{ flex: 1 }}><Text style={styles.placeName} numberOfLines={1}>{p.name}</Text><Text style={styles.placeAddr} numberOfLines={1}>{p.address}</Text></View></Pressable>
          ))}
          <Pressable onPress={() => { setEditing(null); setQuery(""); }} style={{ minHeight: 44, justifyContent: "center" }}><Text style={styles.link}>Annuler</Text></Pressable>
        </View>
      ) : (
        <>
          <Text style={styles.label}>Départ</Text>
          <View style={styles.addr}><Icon name="circle-outline" size={16} color={theme.color.onSurface} /><Text style={styles.addrText} numberOfLines={1}>{ride.pickup.address}</Text></View>

          <View style={styles.rowBetween}><Text style={styles.label}>Arrêts ({stops.length})</Text><Pressable testID="edit-add-stop" onPress={addStop} disabled={stops.length >= 8}><Text style={[styles.link, stops.length >= 8 && { opacity: 0.4 }]}>+ Ajouter un arrêt</Text></Pressable></View>
          {stops.map((s, i) => (
            <View key={i} style={styles.stopRow} testID={`edit-stop-${i}`}>
              <Pressable style={styles.stopAddr} onPress={() => { setEditing(i); setQuery(""); }}><Icon name="map-marker-path" size={16} color={theme.color.onSurface} /><Text style={[styles.addrText, !s.address && { color: theme.color.onSurfaceTertiary }]} numberOfLines={1}>{s.address || "Choisir l'adresse de l'arrêt"}</Text></Pressable>
              <Pressable testID={`edit-stop-up-${i}`} onPress={() => move(i, -1)} hitSlop={6}><Icon name="chevron-up" size={20} color={theme.color.onSurfaceSecondary} /></Pressable>
              <Pressable testID={`edit-stop-down-${i}`} onPress={() => move(i, 1)} hitSlop={6}><Icon name="chevron-down" size={20} color={theme.color.onSurfaceSecondary} /></Pressable>
              <Pressable testID={`edit-stop-del-${i}`} onPress={() => removeStop(i)} hitSlop={6}><Icon name="close" size={18} color={theme.color.error} /></Pressable>
            </View>
          ))}

          <Text style={styles.label}>Destination</Text>
          <Pressable testID="edit-dropoff" onPress={() => { setEditing("dropoff"); setQuery(""); }} style={styles.addr}><Icon name="map-marker" size={16} color={theme.color.error} /><Text style={styles.addrText} numberOfLines={1}>{dropoff.address}</Text><Icon name="pencil" size={16} color={theme.color.onSurfaceTertiary} /></Pressable>

          <Text style={styles.label}>Quand</Text>
          <DateTimeChips value={when} onChange={setWhen} />

          <View style={styles.row2}>
            <Counter testID="edit-pax" label="Passagers" value={pax} min={1} onChange={setPax} />
            <Counter testID="edit-bags" label="Bagages" value={bags} min={0} onChange={setBags} />
          </View>

          <Text style={styles.label}>Véhicule</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {options.map((o) => (
              <Pressable key={o.vehicle_type} testID={`edit-vehicle-${o.vehicle_type}`} disabled={o.fits === false} onPress={() => setVehicle(o.vehicle_type)} style={[styles.veh, vehicle === o.vehicle_type && styles.vehActive, o.fits === false && { opacity: 0.4 }]}>
                <Text style={[styles.vehName, vehicle === o.vehicle_type && { color: theme.color.onBrand }]}>{o.label}</Text>
                <Text style={[styles.vehPrice, vehicle === o.vehicle_type && { color: theme.color.onBrand }]}>{money(o.price)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          {error ? <Text style={styles.error} testID="edit-error">{error}</Text> : null}
        </>
      )}
    </SheetModal>
  );
}

function Counter({ label, value, min, onChange, testID }: { label: string; value: number; min: number; onChange: (n: number) => void; testID: string }) {
  return (
    <View style={styles.counter}>
      <Text style={styles.counterLabel}>{label}</Text>
      <Pressable testID={`${testID}-minus`} onPress={() => onChange(Math.max(min, value - 1))} style={styles.cbtn} hitSlop={6}><Icon name="minus" size={16} color={theme.color.onSurface} /></Pressable>
      <Text style={styles.counterVal}>{value}</Text>
      <Pressable testID={`${testID}-plus`} onPress={() => onChange(Math.min(16, value + 1))} style={styles.cbtn} hitSlop={6}><Icon name="plus" size={16} color={theme.color.onSurface} /></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "700", color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: theme.spacing.md },
  input: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 52, fontSize: 15, color: theme.color.onSurface },
  place: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, minHeight: 56, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  placeName: { fontSize: 15, fontWeight: "600", color: theme.color.onSurface }, placeAddr: { fontSize: 12, color: theme.color.onSurfaceTertiary },
  link: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface, textDecorationLine: "underline" },
  addr: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, minHeight: 52, marginBottom: theme.spacing.sm },
  addrText: { flex: 1, fontSize: 14, color: theme.color.onSurface },
  stopRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  stopAddr: { flex: 1, flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, minHeight: 48 },
  row2: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md },
  veh: { minWidth: 110, padding: theme.spacing.md, borderRadius: theme.radius.md, borderWidth: 1.5, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  vehActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  vehName: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface }, vehPrice: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, marginTop: 4 },
  counter: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, height: 48, flexGrow: 1, marginTop: theme.spacing.md },
  counterLabel: { flex: 1, fontSize: 13, color: theme.color.onSurface }, counterVal: { minWidth: 24, textAlign: "center", fontWeight: "800", color: theme.color.onSurface },
  cbtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.color.border },
  error: { color: theme.color.error, fontSize: 13, marginTop: theme.spacing.md },
  primary: { backgroundColor: theme.color.brand, height: 52, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  primaryText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 15 },
});

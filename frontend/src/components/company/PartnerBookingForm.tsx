import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator, ScrollView } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import SheetModal from "@/src/components/ui/SheetModal";
import Field from "@/src/components/ui/Field";
import DateTimeChips from "@/src/components/ui/DateTimeChips";
import { useAddressSearch } from "@/src/hooks/useAddressSearch";
import { Place } from "@/src/data/places";
import { money } from "@/src/utils/format";
import type { VehicleOption } from "@/src/components/passenger/VehicleCard";

type Props = { visible: boolean; onClose: () => void; onCreated: (ride: any) => void; discount: number };

/** Hotel / concierge booking on behalf of a guest: guest → addresses → time → vehicle (partner rate applied server-side). */
export default function PartnerBookingForm({ visible, onClose, onCreated, discount }: Props) {
  const { token } = useAuth();
  const [guest, setGuest] = useState(""); const [phone, setPhone] = useState(""); const [room, setRoom] = useState(""); const [flight, setFlight] = useState(""); const [notes, setNotes] = useState("");
  const [pickup, setPickup] = useState<Place | null>(null); const [dropoff, setDropoff] = useState<Place | null>(null);
  const [editing, setEditing] = useState<"pickup" | "dropoff" | null>(null); const [query, setQuery] = useState("");
  const { results, searching } = useAddressSearch(query, pickup ? { lat: pickup.lat, lng: pickup.lng } : null);
  const [when, setWhen] = useState<Date | null>(null);
  const [pax, setPax] = useState(1); const [bags, setBags] = useState(1);
  const [options, setOptions] = useState<VehicleOption[]>([]); const [vehicle, setVehicle] = useState<string>("premium");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [guests, setGuests] = useState<any[]>([]);
  const isAirport = (p: Place | null) => /a[ée]roport|airport|cdg|orly|beauvais/i.test(`${p?.name} ${p?.address}`);
  const service = isAirport(pickup) || isAirport(dropoff) ? "airport" : "private";

  useEffect(() => {
    if (!visible) { setGuest(""); setPhone(""); setRoom(""); setFlight(""); setNotes(""); setPickup(null); setDropoff(null); setWhen(null); setOptions([]); setError(null); setPax(1); setBags(1); }
    else apiFetch<any[]>("/company/guests", {}, token).then(setGuests).catch(() => setGuests([]));
  }, [visible]);

  const prefill = (g: any) => { setGuest(g.name || ""); setPhone(g.phone || ""); setRoom(g.room || ""); setNotes(g.notes || ""); if (g.vehicle_type) setVehicle(g.vehicle_type); };
  const removeGuest = async (g: any) => { try { await apiFetch(`/company/guests/${g.id}`, { method: "DELETE" }, token); setGuests((l) => l.filter((x) => x.id !== g.id)); } catch {} };

  useEffect(() => {
    if (!pickup || !dropoff) { setOptions([]); return; }
    apiFetch<{ options: VehicleOption[] }>("/rides/estimate", { method: "POST", body: JSON.stringify({ pickup: { lat: pickup.lat, lng: pickup.lng, address: pickup.address }, dropoff: { lat: dropoff.lat, lng: dropoff.lng, address: dropoff.address }, service_type: service, passengers: pax, luggage: bags }) }, token)
      .then((r) => { setOptions(r.options); if (!r.options.find((o) => o.vehicle_type === vehicle && o.fits !== false)) setVehicle(r.options.find((o) => o.fits !== false)?.vehicle_type || "premium"); })
      .catch(() => {});
  }, [pickup, dropoff, pax, bags, service, token]);

  const pick = (p: Place) => { if (editing === "pickup") setPickup(p); else setDropoff(p); setEditing(null); setQuery(""); };

  const submit = async () => {
    setError(null);
    if (!guest.trim()) { setError("Nom du client requis"); return; }
    if (!pickup || !dropoff) { setError("Adresses de départ et d'arrivée requises"); return; }
    setBusy(true);
    try {
      const ride = await apiFetch<any>("/company/bookings", { method: "POST", body: JSON.stringify({
        pickup: { lat: pickup.lat, lng: pickup.lng, address: pickup.address }, dropoff: { lat: dropoff.lat, lng: dropoff.lng, address: dropoff.address },
        vehicle_type: vehicle, service_type: service, scheduled_at: when ? when.toISOString() : null, passengers: pax, luggage: bags,
        guest_name: guest.trim(), guest_phone: phone.trim() || null, room: room.trim() || null, notes: notes.trim() || null,
        flight_number: service === "airport" && flight.trim() ? flight.trim() : null,
      }) }, token);
      onCreated(ride); onClose();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const selected = options.find((o) => o.vehicle_type === vehicle);
  const net = selected ? selected.price * (1 - discount) : null;

  return (
    <SheetModal visible={visible} onClose={onClose} title="Réserver pour un client" subtitle={discount ? `Tarif partenaire −${Math.round(discount * 100)} % · facturé sur votre relevé mensuel` : "Facturé sur votre relevé mensuel"} testID="partner-booking"
      footer={<Pressable testID="partner-submit" onPress={submit} disabled={busy || !selected} style={[styles.primary, (busy || !selected) && { opacity: 0.5 }]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Confirmer la réservation{net != null ? ` • ${money(net)}` : ""}</Text>}</Pressable>}>
      {editing ? (
        <View testID="partner-address-search">
          <Text style={styles.label}>{editing === "pickup" ? "Adresse de prise en charge" : "Destination"}</Text>
          <TextInput testID="partner-address-input" autoFocus value={query} onChangeText={setQuery} placeholder="Hôtel, aéroport, gare, adresse…" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
          {searching ? <ActivityIndicator style={{ marginTop: 12 }} color={theme.color.onSurface} /> : results.map((p) => (
            <Pressable key={p.id} testID={`partner-place-${p.id}`} onPress={() => pick(p)} style={styles.place}><Icon name="map-marker-outline" size={20} color={theme.color.onSurfaceSecondary} /><View style={{ flex: 1 }}><Text style={styles.placeName} numberOfLines={1}>{p.name}</Text><Text style={styles.placeAddr} numberOfLines={1}>{p.address}</Text></View></Pressable>
          ))}
          <Pressable testID="partner-address-cancel" onPress={() => { setEditing(null); setQuery(""); }} style={{ minHeight: 44, justifyContent: "center" }}><Text style={styles.link}>Annuler</Text></Pressable>
        </View>
      ) : (
        <>
          {guests.length > 0 && (
            <View testID="saved-guests">
              <Text style={styles.label}>Clients enregistrés</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
                {guests.map((g) => (
                  <Pressable key={g.id} testID={`guest-chip-${g.id}`} onPress={() => prefill(g)} style={styles.guestChip}>
                    <Icon name="account-star-outline" size={16} color={theme.color.onSurface} />
                    <View><Text style={styles.guestChipName} numberOfLines={1}>{g.name}</Text>{g.room ? <Text style={styles.guestChipMeta}>ch. {g.room}</Text> : null}</View>
                    <Pressable testID={`guest-del-${g.id}`} onPress={() => removeGuest(g)} hitSlop={8}><Icon name="close" size={14} color={theme.color.onSurfaceTertiary} /></Pressable>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
          <Field testID="guest-name" label="Client (nom affiché au chauffeur)" value={guest} onChangeText={setGuest} placeholder="M. Smith" autoCapitalize="words" />
          <View style={styles.row2}>
            <View style={{ flex: 2, minWidth: 160 }}><Field testID="guest-phone" label="Téléphone (SMS de suivi)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+44 7…" /></View>
            <View style={{ flex: 1, minWidth: 90 }}><Field testID="guest-room" label="Chambre" value={room} onChangeText={setRoom} placeholder="412" /></View>
          </View>
          <Text style={styles.label}>Trajet</Text>
          {(["pickup", "dropoff"] as const).map((k) => { const p = k === "pickup" ? pickup : dropoff; return (
            <Pressable key={k} testID={`partner-${k}`} onPress={() => setEditing(k)} style={styles.addr}>
              <Icon name={k === "pickup" ? "circle-outline" : "map-marker"} size={18} color={theme.color.onSurface} />
              <Text style={[styles.addrText, !p && { color: theme.color.onSurfaceTertiary }]} numberOfLines={1}>{p ? p.address : k === "pickup" ? "Prise en charge (votre hôtel…)" : "Destination (aéroport, gare…)"}</Text>
              <Icon name="chevron-right" size={18} color={theme.color.onSurfaceTertiary} />
            </Pressable>); })}
          {service === "airport" && <Field testID="guest-flight" label="N° de vol (suivi du retard)" value={flight} onChangeText={(t) => setFlight(t.toUpperCase())} autoCapitalize="characters" placeholder="BA309" />}
          <Text style={styles.label}>Quand</Text>
          <DateTimeChips value={when} onChange={setWhen} />
          <View style={styles.row2}>
            <Counter testID="guest-pax" label="Passagers" value={pax} min={1} onChange={setPax} />
            <Counter testID="guest-bags" label="Bagages" value={bags} min={0} onChange={setBags} />
          </View>
          <Text style={styles.label}>Véhicule</Text>
          {!pickup || !dropoff ? <Text style={styles.hint}>Renseignez le trajet pour voir les prix.</Text> : options.length === 0 ? <ActivityIndicator color={theme.color.onSurface} /> : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {options.map((o) => (
                <Pressable key={o.vehicle_type} testID={`partner-vehicle-${o.vehicle_type}`} disabled={o.fits === false} onPress={() => setVehicle(o.vehicle_type)} style={[styles.veh, vehicle === o.vehicle_type && styles.vehActive, o.fits === false && { opacity: 0.4 }]}>
                  <Text style={[styles.vehName, vehicle === o.vehicle_type && { color: theme.color.onBrand }]}>{o.label}</Text>
                  <Text style={[styles.vehPrice, vehicle === o.vehicle_type && { color: theme.color.onBrand }]}>{money(o.price * (1 - discount))}</Text>
                  {o.fixed_price ? <Text style={[styles.vehFixed, vehicle === o.vehicle_type && { color: theme.color.onBrand }]}>Prix fixe</Text> : null}
                </Pressable>
              ))}
            </ScrollView>
          )}
          <Field testID="guest-notes" label="Consignes (optionnel)" value={notes} onChangeText={setNotes} placeholder="Pancarte au nom du client, siège bébé…" />
          {error ? <Text style={styles.error} testID="partner-error">{error}</Text> : null}
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
      <Text style={styles.counterVal} testID={`${testID}-value`}>{value}</Text>
      <Pressable testID={`${testID}-plus`} onPress={() => onChange(Math.min(16, value + 1))} style={styles.cbtn} hitSlop={6}><Icon name="plus" size={16} color={theme.color.onSurface} /></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "700", color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm },
  input: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 52, fontSize: 15, color: theme.color.onSurface },
  place: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, minHeight: 56, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  placeName: { fontSize: 15, fontWeight: "600", color: theme.color.onSurface }, placeAddr: { fontSize: 12, color: theme.color.onSurfaceTertiary },
  link: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface, textDecorationLine: "underline" },
  row2: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.md },
  addr: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, minHeight: 52, marginBottom: theme.spacing.sm },
  addrText: { flex: 1, fontSize: 14, color: theme.color.onSurface },
  hint: { fontSize: 13, color: theme.color.onSurfaceTertiary },
  guestChip: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, paddingVertical: 8, maxWidth: 200 },
  guestChipName: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface, maxWidth: 120 }, guestChipMeta: { fontSize: 10, color: theme.color.onSurfaceTertiary },
  veh: { minWidth: 120, padding: theme.spacing.md, borderRadius: theme.radius.md, borderWidth: 1.5, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  vehActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  vehName: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface }, vehPrice: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, marginTop: 4 }, vehFixed: { fontSize: 10, fontWeight: "700", color: theme.color.success, marginTop: 2 },
  counter: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, height: 48, flexGrow: 1, marginTop: theme.spacing.md },
  counterLabel: { flex: 1, fontSize: 13, color: theme.color.onSurface }, counterVal: { minWidth: 24, textAlign: "center", fontWeight: "800", color: theme.color.onSurface },
  cbtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.color.border },
  error: { color: theme.color.error, fontSize: 13, marginTop: theme.spacing.md },
  primary: { backgroundColor: theme.color.brand, height: 52, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  primaryText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 15 },
});

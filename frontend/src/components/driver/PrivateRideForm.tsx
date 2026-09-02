import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import Field from "@/src/components/ui/Field";
import SheetModal from "@/src/components/ui/SheetModal";
import DateTimeChips from "@/src/components/ui/DateTimeChips";
import { apiFetch, useAuth } from "@/src/context/auth";
import { money } from "@/src/utils/format";

type Props = { visible: boolean; onClose: () => void; onCreated: (ride: any) => void; commissionRate: number };

export default function PrivateRideForm({ visible, onClose, onCreated, commissionRate }: Props) {
  const { token } = useAuth();
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [pickup, setPickup] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [when, setWhen] = useState<Date | null>(new Date(Date.now() + 60 * 60 * 1000));
  const [price, setPrice] = useState("");
  const [payment, setPayment] = useState<"cash" | "card">("cash");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const priceNum = parseFloat(price.replace(",", ".")) || 0;

  const submit = async () => {
    setError(null);
    if (!clientName.trim() || !pickup.trim() || !dropoff.trim() || priceNum <= 0 || !when) { setError("Nom, adresses, date et prix sont requis"); return; }
    setSaving(true);
    try {
      const ride = await apiFetch("/driver/private-rides", {
        method: "POST",
        body: JSON.stringify({
          client_name: clientName.trim(), client_phone: clientPhone.trim() || null,
          pickup_address: pickup.trim(), dropoff_address: dropoff.trim(),
          scheduled_at: when.toISOString(), price: priceNum, payment_method: payment, notes: notes.trim() || null,
        }),
      }, token);
      onCreated(ride);
      setClientName(""); setClientPhone(""); setPickup(""); setDropoff(""); setPrice(""); setNotes("");
      onClose();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <SheetModal visible={visible} onClose={onClose} title="Nouvelle course privée" subtitle="Client obtenu hors plateforme (téléphone, habitué…)" testID="private-ride-form"
      footer={
        <Pressable testID="private-submit" onPress={submit} disabled={saving} style={[styles.primary, saving && { opacity: 0.7 }]}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Enregistrer la course{priceNum > 0 ? ` • ${money(priceNum)}` : ""}</Text>}
        </Pressable>
      }>
      <Field testID="private-client-name" label="Nom du client" value={clientName} onChangeText={setClientName} placeholder="M. Martin" />
      <Field testID="private-client-phone" label="Téléphone (optionnel)" value={clientPhone} onChangeText={setClientPhone} keyboardType="phone-pad" placeholder="+33 6 …" />
      <Field testID="private-pickup" label="Adresse de départ" value={pickup} onChangeText={setPickup} placeholder="12 rue de Rivoli, Paris" />
      <Field testID="private-dropoff" label="Adresse d'arrivée" value={dropoff} onChangeText={setDropoff} placeholder="Aéroport Orly" />

      <Text style={styles.label}>Date et heure</Text>
      <View style={{ marginBottom: theme.spacing.lg }}><DateTimeChips value={when} onChange={setWhen} allowNow={false} days={14} /></View>

      <Field testID="private-price" label="Prix convenu (€)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="45.00"
        hint={priceNum > 0 ? `Commission plateforme à la clôture : ${money(priceNum * commissionRate)} (${Math.round(commissionRate * 100)} %) · Net : ${money(priceNum * (1 - commissionRate))}` : `Une commission de ${Math.round(commissionRate * 100)} % est prélevée uniquement quand la course est terminée.`} />

      <Text style={styles.label}>Mode de paiement</Text>
      <View style={styles.chips}>
        {(["cash", "card"] as const).map((m) => (
          <Pressable key={m} testID={`private-pay-${m}`} onPress={() => setPayment(m)} style={[styles.chip, payment === m && styles.chipActive]}>
            <Icon name={m === "cash" ? "cash" : "credit-card-outline"} size={16} color={payment === m ? "#fff" : theme.color.onSurface} />
            <Text style={[styles.chipText, payment === m && { color: "#fff" }]}>{m === "cash" ? "Espèces" : "Carte / virement"}</Text>
          </Pressable>
        ))}
      </View>

      <Field testID="private-notes" label="Notes internes" value={notes} onChangeText={setNotes} multiline placeholder="Bagages, attente, remarques…" />
      {error ? <Text testID="private-error" style={styles.error}>{error}</Text> : null}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "600", color: theme.color.onSurfaceSecondary, marginBottom: theme.spacing.sm },
  chips: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: theme.spacing.lg, height: 40, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary },
  chipActive: { backgroundColor: theme.color.brand },
  chipText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  error: { color: theme.color.error, fontSize: 14 },
  primary: { backgroundColor: theme.color.brand, height: 54, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});

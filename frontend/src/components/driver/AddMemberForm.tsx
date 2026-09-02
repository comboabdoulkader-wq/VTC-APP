import React, { useState } from "react";
import { Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";

import { theme } from "@/src/theme";
import Field from "@/src/components/ui/Field";
import SheetModal from "@/src/components/ui/SheetModal";
import { apiFetch, useAuth } from "@/src/context/auth";

type Props = { visible: boolean; onClose: () => void; onCreated: (m: any) => void };

export default function AddMemberForm({ visible, onClose, onCreated }: Props) {
  const { token } = useAuth();
  const [form, setForm] = useState({ full_name: "", email: "", password: "", phone: "", vehicle_model: "", license_plate: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError(null);
    if (!form.full_name.trim() || !form.email.trim() || form.password.length < 6) { setError("Nom, email et mot de passe (6 caractères min.) requis"); return; }
    setSaving(true);
    try {
      const m = await apiFetch("/team/members", {
        method: "POST",
        body: JSON.stringify({ ...form, email: form.email.trim(), phone: form.phone || null, vehicle_model: form.vehicle_model || null, license_plate: form.license_plate || null }),
      }, token);
      onCreated(m);
      setForm({ full_name: "", email: "", password: "", phone: "", vehicle_model: "", license_plate: "" });
      onClose();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <SheetModal visible={visible} onClose={onClose} title="Ajouter un chauffeur" subtitle="Le chauffeur se connectera avec ces identifiants" testID="add-member-form"
      footer={
        <Pressable testID="member-submit" onPress={submit} disabled={saving} style={[styles.primary, saving && { opacity: 0.7 }]}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Créer le compte chauffeur</Text>}
        </Pressable>
      }>
      <Field testID="member-name" label="Nom complet" value={form.full_name} onChangeText={set("full_name")} placeholder="Karim Benali" />
      <Field testID="member-email" label="Email de connexion" value={form.email} onChangeText={set("email")} autoCapitalize="none" keyboardType="email-address" placeholder="karim@flotte.fr" />
      <Field testID="member-password" label="Mot de passe provisoire" value={form.password} onChangeText={set("password")} secureTextEntry placeholder="Min. 6 caractères" />
      <Field testID="member-phone" label="Téléphone" value={form.phone} onChangeText={set("phone")} keyboardType="phone-pad" placeholder="+33 6 …" />
      <Field testID="member-vehicle" label="Véhicule" value={form.vehicle_model} onChangeText={set("vehicle_model")} placeholder="Tesla Model 3" />
      <Field testID="member-plate" label="Immatriculation" value={form.license_plate} onChangeText={set("license_plate")} autoCapitalize="characters" placeholder="AB-123-CD" />
      {error ? <Text testID="member-error" style={styles.error}>{error}</Text> : null}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  error: { color: theme.color.error, fontSize: 14 },
  primary: { backgroundColor: theme.color.brand, height: 54, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});

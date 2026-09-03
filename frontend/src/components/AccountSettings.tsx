import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import SheetModal from "@/src/components/ui/SheetModal";
import Field from "@/src/components/ui/Field";

type Props = { visible: boolean; onClose: () => void; section: "info" | "security" };

/** Profile editing (name, vehicle) and password change. Phone is handled by PhoneVerifyCard (SMS OTP). */
export default function AccountSettings({ visible, onClose, section }: Props) {
  const { user, token, refresh } = useAuth();
  const [fullName, setFullName] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [plate, setPlate] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !user) return;
    setFullName(user.full_name); setVehicle(user.vehicle_model || ""); setPlate(user.license_plate || "");
    setCurrent(""); setNext(""); setConfirm(""); setError(null);
  }, [visible, user]);

  if (!user) return null;

  const saveInfo = async () => {
    setError(null);
    if (!fullName.trim()) { setError("Le nom est requis"); return; }
    setBusy(true);
    try {
      await apiFetch("/auth/me", { method: "PATCH", body: JSON.stringify({ full_name: fullName.trim(), ...(user.role === "driver" ? { vehicle_model: vehicle, license_plate: plate } : {}) }) }, token);
      await refresh(); onClose();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const savePassword = async () => {
    setError(null);
    if (next.length < 8) { setError("Nouveau mot de passe : 8 caractères minimum"); return; }
    if (next !== confirm) { setError("Les deux mots de passe ne correspondent pas"); return; }
    setBusy(true);
    try {
      await apiFetch("/auth/password", { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) }, token);
      onClose(); Alert.alert("Mot de passe modifié", "Votre nouveau mot de passe est actif.");
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const isInfo = section === "info";
  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      title={isInfo ? "Informations personnelles" : "Sécurité"}
      subtitle={isInfo ? "Ces informations sont visibles par vos interlocuteurs" : "Modifier votre mot de passe"}
      testID="account-settings"
      footer={
        <Pressable testID="settings-save" onPress={isInfo ? saveInfo : savePassword} disabled={busy} style={[styles.primary, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Enregistrer</Text>}
        </Pressable>
      }
    >
      {isInfo ? (
        <>
          <Field testID="settings-name" label="Nom complet" value={fullName} onChangeText={setFullName} autoCapitalize="words" />
          <Field label="Email" value={user.email} editable={false} hint="L'email de connexion ne peut pas être modifié" style={{ opacity: 0.6 }} />
          {user.role === "driver" && (
            <>
              <Field testID="settings-vehicle" label="Modèle du véhicule" value={vehicle} onChangeText={setVehicle} placeholder="Peugeot 508" />
              <Field testID="settings-plate" label="Plaque d'immatriculation" value={plate} onChangeText={setPlate} autoCapitalize="characters" placeholder="AB-123-CD" />
            </>
          )}
          <Text style={styles.hint}>Le numéro de téléphone se modifie depuis la carte « Alertes SMS » de votre profil (vérification par code).</Text>
        </>
      ) : (
        <>
          <Field testID="pwd-current" label="Mot de passe actuel" value={current} onChangeText={setCurrent} secureTextEntry={!show} autoComplete="current-password" />
          <Field testID="pwd-new" label="Nouveau mot de passe" value={next} onChangeText={setNext} secureTextEntry={!show} autoComplete="new-password" hint="8 caractères minimum" />
          <Field testID="pwd-confirm" label="Confirmer le nouveau mot de passe" value={confirm} onChangeText={setConfirm} secureTextEntry={!show} autoComplete="new-password" />
          <Pressable testID="pwd-toggle" onPress={() => setShow((v) => !v)} style={styles.showRow} hitSlop={8}>
            <Icon name={show ? "eye-off-outline" : "eye-outline"} size={18} color={theme.color.onSurfaceSecondary} />
            <Text style={styles.showText}>{show ? "Masquer" : "Afficher"} les mots de passe</Text>
          </Pressable>
        </>
      )}
      {error ? <Text style={styles.error} testID="settings-error">{error}</Text> : null}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  primary: { backgroundColor: theme.color.brand, height: 52, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  primaryText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 15 },
  hint: { fontSize: 12, color: theme.color.onSurfaceTertiary, lineHeight: 17 },
  showRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 },
  showText: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: "600" },
  error: { color: theme.color.error, fontSize: 13, marginTop: theme.spacing.md },
});

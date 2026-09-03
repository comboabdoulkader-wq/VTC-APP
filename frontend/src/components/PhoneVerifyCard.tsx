import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Switch, ActivityIndicator, Alert } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";

type SendOut = { ok: boolean; phone: string; delivered: boolean; expires_in_min: number; dev_code?: string };

/** Phone number + SMS OTP verification (Twilio) and SMS alerts preference. Used in profiles and after sign-up. */
export default function PhoneVerifyCard({ onVerified }: { onVerified?: () => void }) {
  const { user, token, refresh } = useAuth();
  const [phone, setPhone] = useState(user?.phone || "");
  const [editing, setEditing] = useState(!user?.phone);
  const [sent, setSent] = useState<SendOut | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!user) return null;
  const verified = !!user.phone_verified && !editing;

  const sendCode = async () => {
    setError(null); setBusy(true);
    try {
      const r = await apiFetch<SendOut>("/auth/phone/send-code", { method: "POST", body: JSON.stringify({ phone }) }, token);
      setSent(r); setCode(""); setCooldown(30);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const verify = async () => {
    setError(null); setBusy(true);
    try {
      await apiFetch("/auth/phone/verify", { method: "POST", body: JSON.stringify({ code }) }, token);
      await refresh();
      setSent(null); setEditing(false); setCode("");
      onVerified?.();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const toggleSms = async (v: boolean) => {
    try { await apiFetch("/auth/me", { method: "PATCH", body: JSON.stringify({ sms_enabled: v }) }, token); await refresh(); }
    catch (e: any) { Alert.alert("Erreur", e.message); }
  };

  return (
    <View style={styles.card} testID="phone-card">
      <View style={styles.head}>
        <View style={[styles.iconWrap, verified && { backgroundColor: "#E6F4EC" }]}>
          <Icon name={verified ? "cellphone-check" : "cellphone-message"} size={22} color={verified ? theme.color.success : theme.color.onSurface} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Alertes SMS</Text>
          <Text style={styles.meta}>
            {verified ? `Numéro vérifié · ${user.phone}` : user.phone && !editing ? `${user.phone} · non vérifié` : "Recevez un SMS quand votre chauffeur arrive"}
          </Text>
        </View>
        {verified && <Icon name="check-decagram" size={22} color={theme.color.success} testID="phone-verified-badge" />}
      </View>

      {verified ? (
        <>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Recevoir les alertes par SMS (chauffeur en approche, course acceptée, rappels)</Text>
            <Switch testID="sms-switch" value={user.sms_enabled !== false} onValueChange={toggleSms} trackColor={{ true: theme.color.success, false: theme.color.borderStrong }} thumbColor="#fff" />
          </View>
          <Pressable testID="phone-edit" onPress={() => { setEditing(true); setSent(null); }} style={{ marginTop: theme.spacing.sm }}>
            <Text style={styles.link}>Modifier le numéro</Text>
          </Pressable>
        </>
      ) : !sent ? (
        <View style={styles.inputRow}>
          <TextInput
            testID="phone-verify-input"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="+33 6 12 34 56 78"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            style={styles.input}
          />
          <Pressable testID="phone-send-code" onPress={sendCode} disabled={busy || phone.replace(/\D/g, "").length < 9} style={[styles.btn, (busy || phone.replace(/\D/g, "").length < 9) && { opacity: 0.5 }]}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Recevoir un code</Text>}
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={styles.meta}>Code envoyé au {sent.phone} · valable {sent.expires_in_min} min</Text>
          {sent.dev_code ? (
            <View style={styles.devBox} testID="otp-dev-code">
              <Icon name="flask-outline" size={16} color={theme.color.warning} />
              <Text style={styles.devText}>Mode test (Twilio non configuré) : votre code est <Text style={{ fontWeight: "800" }}>{sent.dev_code}</Text></Text>
            </View>
          ) : null}
          <View style={styles.inputRow}>
            <TextInput
              testID="otp-input"
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              placeholder="Code à 6 chiffres"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={[styles.input, { letterSpacing: 4, fontWeight: "800" }]}
              maxLength={6}
            />
            <Pressable testID="otp-verify" onPress={verify} disabled={busy || code.length !== 6} style={[styles.btn, (busy || code.length !== 6) && { opacity: 0.5 }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Vérifier</Text>}
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: theme.spacing.sm }}>
            <Pressable testID="otp-change-phone" onPress={() => setSent(null)}><Text style={styles.link}>Changer de numéro</Text></Pressable>
            <Pressable testID="otp-resend" onPress={sendCode} disabled={cooldown > 0 || busy}><Text style={[styles.link, cooldown > 0 && { color: theme.color.onSurfaceTertiary }]}>{cooldown > 0 ? `Renvoyer (${cooldown}s)` : "Renvoyer le code"}</Text></Pressable>
          </View>
        </>
      )}
      {error ? <Text style={styles.error} testID="phone-error">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.xl },
  head: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, marginBottom: theme.spacing.md },
  iconWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  meta: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2, lineHeight: 17 },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  rowLabel: { flex: 1, fontSize: 13, color: theme.color.onSurface, lineHeight: 18 },
  inputRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  input: { flexGrow: 1, flexBasis: 160, minWidth: 0, backgroundColor: theme.color.surface, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 48, fontSize: 15, color: theme.color.onSurface, borderWidth: 1, borderColor: theme.color.border },
  btn: { flexGrow: 1, backgroundColor: theme.color.brand, paddingHorizontal: theme.spacing.lg, height: 48, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", minWidth: 96 },
  btnText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 13 },
  link: { fontSize: 13, color: theme.color.onSurface, fontWeight: "700", textDecorationLine: "underline" },
  error: { color: theme.color.error, fontSize: 13, marginTop: theme.spacing.sm },
  devBox: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: "#FFF6E9", borderRadius: theme.radius.sm, padding: theme.spacing.sm, marginTop: theme.spacing.sm },
  devText: { flex: 1, fontSize: 12, color: theme.color.onSurface },
});

import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, homeFor, useAuth, User } from "@/src/context/auth";

type SendOut = { ok: boolean; masked_phone: string; delivered: boolean; expires_in_min: number; dev_code?: string };

/** Password reset by SMS code: identifier (email or phone) → 6-digit code → new password → auto sign-in. */
export default function ForgotPassword() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setSession } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [sent, setSent] = useState<SendOut | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    setError(null); setBusy(true);
    try {
      const r = await apiFetch<SendOut>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ identifier: identifier.trim() }) });
      setSent(r); setCooldown(30);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const reset = async () => {
    setError(null);
    if (password.length < 8) { setError("Mot de passe : 8 caractères minimum"); return; }
    setBusy(true);
    try {
      const r = await apiFetch<{ access_token: string; user: User }>("/auth/reset-password", {
        method: "POST", body: JSON.stringify({ identifier: identifier.trim(), code, new_password: password }),
      });
      await setSession(r.access_token, r.user);
      router.replace(homeFor(r.user.role) as any);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const canSend = identifier.trim().length >= 3 && !busy;
  const canReset = code.length === 6 && password.length >= 8 && !busy;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + theme.spacing.md, paddingBottom: insets.bottom + theme.spacing.xl }]} keyboardShouldPersistTaps="handled" testID="forgot-screen">
        <Pressable testID="back-button" onPress={() => router.back()} style={styles.back} hitSlop={8}>
          <Icon name="chevron-left" size={28} color={theme.color.onSurface} />
        </Pressable>
        <Text style={styles.title}>Mot de passe oublié</Text>
        <Text style={styles.subtitle}>
          {sent
            ? `Un code a été envoyé au ${sent.masked_phone} · valable ${sent.expires_in_min} min`
            : "Saisissez votre email ou votre numéro de téléphone vérifié : nous vous envoyons un code par SMS."}
        </Text>

        {!sent ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Email ou téléphone</Text>
              <TextInput
                testID="forgot-identifier"
                value={identifier}
                onChangeText={setIdentifier}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="votre@email.com ou +33 6 12 34 56 78"
                placeholderTextColor={theme.color.onSurfaceTertiary}
                style={styles.input}
                onSubmitEditing={() => canSend && sendCode()}
                returnKeyType="send"
              />
            </View>
            {error ? <Text testID="forgot-error" style={styles.error}>{error}</Text> : null}
            <Pressable testID="forgot-send" onPress={sendCode} disabled={!canSend} style={[styles.primary, !canSend && { opacity: 0.5 }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Recevoir un code par SMS</Text>}
            </Pressable>
          </>
        ) : (
          <>
            {sent.dev_code ? (
              <View style={styles.devBox} testID="forgot-dev-code">
                <Icon name="flask-outline" size={16} color={theme.color.warning} />
                <Text style={styles.devText}>Mode test (Twilio non configuré) : votre code est <Text style={{ fontWeight: "800" }}>{sent.dev_code}</Text></Text>
              </View>
            ) : null}
            <View style={styles.field}>
              <Text style={styles.label}>Code reçu par SMS</Text>
              <TextInput
                testID="forgot-code"
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
                placeholder="000000"
                placeholderTextColor={theme.color.onSurfaceTertiary}
                style={[styles.input, { letterSpacing: 6, fontWeight: "800", fontSize: 20 }]}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Nouveau mot de passe</Text>
              <View style={styles.pwdRow}>
                <TextInput
                  testID="forgot-new-password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPwd}
                  autoComplete="new-password"
                  placeholder="Min. 8 caractères"
                  placeholderTextColor={theme.color.onSurfaceTertiary}
                  style={[styles.input, { flex: 1 }]}
                />
                <Pressable testID="forgot-toggle-password" onPress={() => setShowPwd((v) => !v)} style={styles.eye} hitSlop={8}>
                  <Icon name={showPwd ? "eye-off-outline" : "eye-outline"} size={22} color={theme.color.onSurfaceSecondary} />
                </Pressable>
              </View>
            </View>
            {error ? <Text testID="forgot-error" style={styles.error}>{error}</Text> : null}
            <Pressable testID="forgot-submit" onPress={reset} disabled={!canReset} style={[styles.primary, !canReset && { opacity: 0.5 }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Réinitialiser et me connecter</Text>}
            </Pressable>
            <View style={styles.links}>
              <Pressable testID="forgot-change-id" onPress={() => { setSent(null); setCode(""); setError(null); }} hitSlop={8}><Text style={styles.link}>Changer d'identifiant</Text></Pressable>
              <Pressable testID="forgot-resend" onPress={sendCode} disabled={cooldown > 0 || busy} hitSlop={8}>
                <Text style={[styles.link, cooldown > 0 && { color: theme.color.onSurfaceTertiary }]}>{cooldown > 0 ? `Renvoyer (${cooldown}s)` : "Renvoyer le code"}</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: theme.spacing.xl },
  back: { width: 40, height: 40, alignItems: "flex-start", justifyContent: "center", marginBottom: theme.spacing.md },
  title: { fontSize: 32, fontWeight: "800", color: theme.color.onSurface, letterSpacing: -1 },
  subtitle: { fontSize: 15, color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.sm, marginBottom: theme.spacing.xl, lineHeight: 22 },
  field: { marginBottom: theme.spacing.lg },
  label: { fontSize: 13, fontWeight: "600", color: theme.color.onSurfaceSecondary, marginBottom: theme.spacing.sm },
  input: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 56, fontSize: 16, color: theme.color.onSurface },
  pwdRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  eye: { width: 48, height: 56, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceSecondary },
  error: { color: theme.color.error, fontSize: 14, marginBottom: theme.spacing.md },
  primary: { backgroundColor: theme.color.brand, height: 56, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.md, marginBottom: theme.spacing.lg },
  primaryText: { color: theme.color.onBrand, fontWeight: "700", fontSize: 16 },
  links: { flexDirection: "row", justifyContent: "space-between" },
  link: { fontSize: 14, color: theme.color.onSurface, fontWeight: "700", textDecorationLine: "underline" },
  devBox: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: "#FFF6E9", borderRadius: theme.radius.sm, padding: theme.spacing.md, marginBottom: theme.spacing.lg },
  devText: { flex: 1, fontSize: 13, color: theme.color.onSurface },
});

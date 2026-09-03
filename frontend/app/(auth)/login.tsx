import { useState } from "react";
import {
  View, Text, StyleSheet, Pressable, TextInput, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { useAuth, homeFor } from "@/src/context/auth";

export default function Login() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) { setError("Renseignez email et mot de passe"); return; }
    setLoading(true);
    try {
      const u = await login(email.trim(), password);
      router.replace(homeFor(u.role) as any);
    } catch (e: any) {
      setError(e.message || "Erreur de connexion");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + theme.spacing.md, paddingBottom: insets.bottom + theme.spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable testID="back-button" onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Icon name="chevron-left" size={28} color={theme.color.onSurface} />
        </Pressable>

        <Text style={styles.title}>{t("welcome_back")}</Text>
        <Text style={styles.subtitle}>{t("login_subtitle")}</Text>

        <View style={styles.field}>
          <Text style={styles.label}>{t("email")}</Text>
          <TextInput
            testID="email-input"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="votre@email.com"
            placeholderTextColor={theme.color.onSurfaceTertiary}
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t("password")}</Text>
          <View style={styles.pwdRow}>
            <TextInput
              testID="password-input"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPwd}
              autoComplete="current-password"
              placeholder="••••••••"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={[styles.input, { flex: 1 }]}
              onSubmitEditing={submit}
              returnKeyType="go"
            />
            <Pressable testID="toggle-password" onPress={() => setShowPwd((v) => !v)} style={styles.eye} hitSlop={8} accessibilityLabel={showPwd ? "Masquer le mot de passe" : "Afficher le mot de passe"}>
              <Icon name={showPwd ? "eye-off-outline" : "eye-outline"} size={22} color={theme.color.onSurfaceSecondary} />
            </Pressable>
          </View>
        </View>

        {error ? <Text testID="error-message" style={styles.error}>{error}</Text> : null}

        <Pressable testID="forgot-password" onPress={() => router.push("/(auth)/forgot-password" as any)} style={styles.forgot} hitSlop={8}>
          <Text style={styles.forgotText}>{t("forgot_password")}</Text>
        </Pressable>

        <Pressable
          testID="login-submit-button"
          onPress={submit}
          disabled={loading}
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }, loading && { opacity: 0.7 }]}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{t("login")}</Text>}
        </Pressable>

        <Pressable testID="go-to-register" onPress={() => router.replace("/(auth)/register")}>
          <Text style={styles.link}>{t("no_account")} <Text style={{ fontWeight: "700" }}>{t("register")}</Text></Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: theme.spacing.xl },
  back: { width: 40, height: 40, alignItems: "flex-start", justifyContent: "center", marginBottom: theme.spacing.md },
  title: { fontSize: 32, fontWeight: "800", color: theme.color.onSurface, letterSpacing: -1 },
  subtitle: { fontSize: 16, color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.sm, marginBottom: theme.spacing.xl },
  field: { marginBottom: theme.spacing.lg },
  label: { fontSize: 13, fontWeight: "600", color: theme.color.onSurfaceSecondary, marginBottom: theme.spacing.sm },
  input: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 56, fontSize: 16, color: theme.color.onSurface },
  pwdRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  eye: { width: 48, height: 56, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceSecondary },
  error: { color: theme.color.error, fontSize: 14, marginBottom: theme.spacing.md },
  forgot: { alignSelf: "flex-end", minHeight: 40, justifyContent: "center" },
  forgotText: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface, textDecorationLine: "underline" },
  primary: { backgroundColor: theme.color.brand, height: 56, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.md, marginBottom: theme.spacing.lg },
  primaryText: { color: theme.color.onBrand, fontWeight: "700", fontSize: 16 },
  link: { textAlign: "center", color: theme.color.onSurfaceSecondary, fontSize: 14 },
});

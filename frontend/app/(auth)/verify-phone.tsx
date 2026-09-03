import { View, Text, StyleSheet, Pressable, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useAuth, homeFor } from "@/src/context/auth";
import PhoneVerifyCard from "@/src/components/PhoneVerifyCard";

/** Optional step right after sign-up: verify the phone number by SMS code. Can be skipped and done later from the profile. */
export default function VerifyPhone() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const goHome = () => router.replace((user ? homeFor(user.role) : "/(auth)/welcome") as any);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + theme.spacing.xl, paddingBottom: insets.bottom + theme.spacing.xl }]} keyboardShouldPersistTaps="handled" testID="verify-phone-screen">
        <View style={styles.hero}><Icon name="message-text-lock-outline" size={40} color={theme.color.onSurface} /></View>
        <Text style={styles.title}>Vérifiez votre numéro</Text>
        <Text style={styles.subtitle}>
          Nous vous envoyons un code par SMS. Une fois vérifié, vous recevrez une alerte quand votre chauffeur est à moins de 2 minutes, même si l'application est fermée.
        </Text>
        <PhoneVerifyCard onVerified={goHome} />
        <Pressable testID="skip-phone" onPress={goHome} style={styles.skip} hitSlop={8}>
          <Text style={styles.skipText}>Plus tard</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: theme.spacing.xl },
  hero: { width: 80, height: 80, borderRadius: 40, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.lg },
  title: { fontSize: 30, fontWeight: "800", color: theme.color.onSurface, letterSpacing: -1 },
  subtitle: { fontSize: 15, color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.sm, marginBottom: theme.spacing.xl, lineHeight: 22 },
  skip: { alignSelf: "center", minHeight: 48, justifyContent: "center", paddingHorizontal: theme.spacing.xl },
  skipText: { fontSize: 15, fontWeight: "700", color: theme.color.onSurfaceSecondary },
});

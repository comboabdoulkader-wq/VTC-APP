import { useState } from "react";
import {
  View, Text, StyleSheet, Pressable, TextInput, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useAuth, Role } from "@/src/context/auth";

export default function Register() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { register } = useAuth();

  const [role, setRole] = useState<Role>("passenger");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    if (!fullName.trim() || !email.trim() || !password) {
      setError("Renseignez tous les champs requis"); return;
    }
    if (password.length < 6) { setError("Mot de passe: 6 caractères minimum"); return; }
    if (role === "driver" && (!vehicleModel.trim() || !licensePlate.trim())) {
      setError("Renseignez le modèle et la plaque du véhicule"); return;
    }
    setLoading(true);
    try {
      const u = await register({
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        role,
        phone: phone.trim() || undefined,
        vehicle_model: role === "driver" ? vehicleModel.trim() : undefined,
        license_plate: role === "driver" ? licensePlate.trim() : undefined,
      });
      router.replace(u.role === "passenger" ? "/(passenger)" : "/(driver)");
    } catch (e: any) {
      setError(e.message || "Erreur d'inscription");
    } finally { setLoading(false); }
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

        <Text style={styles.title}>Créer un compte</Text>
        <Text style={styles.subtitle}>Rejoignez RideGo en quelques secondes</Text>

        <View style={styles.roleRow}>
          <Pressable
            testID="role-passenger"
            onPress={() => setRole("passenger")}
            style={[styles.roleBtn, role === "passenger" && styles.roleBtnActive]}
          >
            <Icon name="account" size={22} color={role === "passenger" ? theme.color.onBrand : theme.color.onSurface} />
            <Text style={[styles.roleText, role === "passenger" && styles.roleTextActive]}>Passager</Text>
          </Pressable>
          <Pressable
            testID="role-driver"
            onPress={() => setRole("driver")}
            style={[styles.roleBtn, role === "driver" && styles.roleBtnActive]}
          >
            <Icon name="steering" size={22} color={role === "driver" ? theme.color.onBrand : theme.color.onSurface} />
            <Text style={[styles.roleText, role === "driver" && styles.roleTextActive]}>Chauffeur</Text>
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Nom complet</Text>
          <TextInput testID="fullname-input" value={fullName} onChangeText={setFullName} placeholder="Jean Dupont" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Email</Text>
          <TextInput testID="email-input" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="votre@email.com" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Téléphone (optionnel)</Text>
          <TextInput testID="phone-input" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+33 6 12 34 56 78" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Mot de passe</Text>
          <TextInput testID="password-input" value={password} onChangeText={setPassword} secureTextEntry placeholder="Min. 6 caractères" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
        </View>

        {role === "driver" && (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Modèle du véhicule</Text>
              <TextInput testID="vehicle-input" value={vehicleModel} onChangeText={setVehicleModel} placeholder="Peugeot 508" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Plaque d'immatriculation</Text>
              <TextInput testID="plate-input" value={licensePlate} onChangeText={setLicensePlate} autoCapitalize="characters" placeholder="AB-123-CD" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
            </View>
          </>
        )}

        {error ? <Text testID="error-message" style={styles.error}>{error}</Text> : null}

        <Pressable
          testID="register-submit-button"
          onPress={submit}
          disabled={loading}
          style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }, loading && { opacity: 0.7 }]}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Créer mon compte</Text>}
        </Pressable>

        <Pressable testID="go-to-login" onPress={() => router.replace("/(auth)/login")}>
          <Text style={styles.link}>Déjà un compte ? <Text style={{ fontWeight: "700" }}>Se connecter</Text></Text>
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
  roleRow: { flexDirection: "row", gap: theme.spacing.md, marginBottom: theme.spacing.xl },
  roleBtn: { flex: 1, height: 56, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: theme.spacing.sm, borderWidth: 1, borderColor: "transparent" },
  roleBtnActive: { backgroundColor: theme.color.brand },
  roleText: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  roleTextActive: { color: theme.color.onBrand },
  field: { marginBottom: theme.spacing.lg },
  label: { fontSize: 13, fontWeight: "600", color: theme.color.onSurfaceSecondary, marginBottom: theme.spacing.sm },
  input: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 56, fontSize: 16, color: theme.color.onSurface },
  error: { color: theme.color.error, fontSize: 14, marginBottom: theme.spacing.md },
  primary: { backgroundColor: theme.color.brand, height: 56, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.md, marginBottom: theme.spacing.lg },
  primaryText: { color: theme.color.onBrand, fontWeight: "700", fontSize: 16 },
  link: { textAlign: "center", color: theme.color.onSurfaceSecondary, fontSize: 14 },
});

import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useAuth } from "@/src/context/auth";

export default function DriverProfile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();

  const doLogout = async () => {
    await logout();
    router.replace("/(auth)/welcome");
  };

  if (!user) return null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.color.surface }}
      contentContainerStyle={{ paddingTop: insets.top + theme.spacing.lg, paddingBottom: insets.bottom + theme.spacing.xxl, paddingHorizontal: theme.spacing.xl }}
      testID="driver-profile-screen"
    >
      <Text style={styles.title}>Profil chauffeur</Text>

      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user.full_name.substring(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={styles.name}>{user.full_name}</Text>
        <Text style={styles.email}>{user.email}</Text>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <Icon name="star" size={18} color={theme.color.star} />
            <Text style={styles.statValue}>{user.rating.toFixed(1)}</Text>
            <Text style={styles.statLabel}>Note</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.stat}>
            <Icon name="car-multiple" size={18} color={theme.color.onSurface} />
            <Text style={styles.statValue}>{user.total_rides}</Text>
            <Text style={styles.statLabel}>Courses</Text>
          </View>
        </View>
      </View>

      <View style={styles.vehicle}>
        <Icon name="car" size={28} color={theme.color.onSurface} />
        <View style={{ flex: 1 }}>
          <Text style={styles.vehicleName}>{user.vehicle_model || "Véhicule non renseigné"}</Text>
          <Text style={styles.vehiclePlate}>{user.license_plate || "—"}</Text>
        </View>
      </View>

      <Pressable testID="logout-button" style={styles.logout} onPress={doLogout}>
        <Icon name="logout" size={20} color={theme.color.error} />
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 32, fontWeight: "800", color: theme.color.onSurface, marginBottom: theme.spacing.lg, letterSpacing: -1 },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.lg, padding: theme.spacing.xl, alignItems: "center", marginBottom: theme.spacing.lg },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.md },
  avatarText: { color: "#fff", fontSize: 28, fontWeight: "800" },
  name: { fontSize: 20, fontWeight: "800", color: theme.color.onSurface },
  email: { fontSize: 14, color: theme.color.onSurfaceSecondary, marginTop: 4 },
  stats: { flexDirection: "row", marginTop: theme.spacing.lg, backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, alignSelf: "stretch" },
  stat: { flex: 1, alignItems: "center", gap: 4 },
  statValue: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  statLabel: { fontSize: 12, color: theme.color.onSurfaceTertiary },
  divider: { width: 1, backgroundColor: theme.color.border, marginHorizontal: theme.spacing.md },
  vehicle: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.md, marginBottom: theme.spacing.xl },
  vehicleName: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  vehiclePlate: { fontSize: 13, color: theme.color.onSurfaceTertiary, marginTop: 2, fontWeight: "600" },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surfaceSecondary, height: 52, borderRadius: theme.radius.pill },
  logoutText: { color: theme.color.error, fontWeight: "700", fontSize: 15 },
});

import { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useAuth } from "@/src/context/auth";
import CitiesModeration from "@/src/components/CitiesModeration";
import DriversAdmin from "@/src/components/admin/DriversAdmin";
import { getNavApp, setNavApp, NavApp } from "@/src/utils/files";

export default function DriverProfile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [showCities, setShowCities] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [nav, setNav] = useState<NavApp | null>(null);
  useEffect(() => { getNavApp().then(setNav); }, []);
  const chooseNav = (a: NavApp) => { setNav(a); setNavApp(a); };

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

            <View style={[styles.menuGroup, { padding: theme.spacing.lg }]} testID="nav-preference">
        <Text style={{ fontSize: 15, fontWeight: "700", color: theme.color.onSurface, marginBottom: 4 }}>Navigation GPS par défaut</Text>
        <Text style={{ fontSize: 12, color: theme.color.onSurfaceTertiary, marginBottom: theme.spacing.md }}>Application ouverte par « Aller au client » et « Aller à destination »</Text>
        <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
          {(["waze", "gmaps"] as NavApp[]).map((a) => (
            <Pressable key={a} testID={`nav-${a}`} onPress={() => chooseNav(a)} style={{ flex: 1, height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, backgroundColor: nav === a ? theme.color.brand : theme.color.surface }}>
              <Icon name={a === "waze" ? "waze" : "google-maps"} size={18} color={nav === a ? "#fff" : theme.color.onSurface} />
              <Text style={{ fontWeight: "800", fontSize: 13, color: nav === a ? "#fff" : theme.color.onSurface }}>{a === "waze" ? "Waze" : "Google Maps"}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {user.is_moderator && (
        <Pressable testID="open-drivers-admin" onPress={() => setShowAdmin(true)} style={[styles.menuGroup, { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg }]}>
          <Icon name="shield-account-outline" size={22} color={theme.color.onSurface} />
          <Text style={{ flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: "600" }}>Administration chauffeurs & documents</Text>
          <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>
      )}
      <DriversAdmin visible={showAdmin} onClose={() => setShowAdmin(false)} />
      {user.is_moderator && (
        <Pressable testID="open-cities-moderation" onPress={() => setShowCities(true)} style={[styles.menuGroup, { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg }]}>
          <Icon name="city-variant-outline" size={22} color={theme.color.onSurface} />
          <Text style={{ flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: "600" }}>Modération des centres-villes</Text>
          <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>
      )}
      <CitiesModeration visible={showCities} onClose={() => setShowCities(false)} />

<Pressable testID="logout-button" style={styles.logout} onPress={doLogout}>
        <Icon name="logout" size={20} color={theme.color.error} />
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  menuGroup: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, marginBottom: theme.spacing.xl },
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

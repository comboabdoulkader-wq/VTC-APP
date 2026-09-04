import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { useAuth } from "@/src/context/auth";
import CitiesModeration from "@/src/components/CitiesModeration";
import DriversAdmin from "@/src/components/admin/DriversAdmin";
import PayoutsAdmin from "@/src/components/admin/PayoutsAdmin";
import ApiManager from "@/src/components/admin/ApiManager";
import AdminDashboard from "@/src/components/admin/AdminDashboard";
import CommissionSettings from "@/src/components/admin/CommissionSettings";
import DispatchSettings from "@/src/components/admin/DispatchSettings";
import PromosManager from "@/src/components/PromosManager";
import CompanyJoinCard from "@/src/components/CompanyJoinCard";
import WalletCard from "@/src/components/WalletCard";
import LoyaltyCard from "@/src/components/passenger/LoyaltyCard";
import PhoneVerifyCard from "@/src/components/PhoneVerifyCard";
import AccountSection from "@/src/components/AccountSection";
import LanguagePicker from "@/src/components/LanguagePicker";
import CatalogAdmin from "@/src/components/admin/CatalogAdmin";

export default function Profile() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [showCatalog, setShowCatalog] = useState(false);
  const [showCities, setShowCities] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showPayouts, setShowPayouts] = useState(false);
  const [showApi, setShowApi] = useState(false);
  const [showDash, setShowDash] = useState(false);
  const [showComm, setShowComm] = useState(false);
  const [showDispatch, setShowDispatch] = useState(false);
  const [showPromos, setShowPromos] = useState(false);

  const doLogout = async () => {
    await logout();
    router.replace("/(auth)/welcome");
  };

  if (!user) return null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.color.surface }}
      contentContainerStyle={{ paddingTop: insets.top + theme.spacing.lg, paddingBottom: insets.bottom + theme.spacing.xxl, paddingHorizontal: theme.spacing.xl }}
      testID="profile-screen"
    >
      <Text style={styles.title} maxFontSizeMultiplier={1.3} numberOfLines={1} adjustsFontSizeToFit>{t("profile")}</Text>

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

      <LoyaltyCard />
      <WalletCard />
      <PhoneVerifyCard />
      <LanguagePicker />
      <AccountSection />

      <CompanyJoinCard />

      {user.is_moderator && (
        <Pressable testID="open-promos" onPress={() => setShowPromos(true)} style={[styles.menuGroup, { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg }]}>
          <Icon name="ticket-percent-outline" size={22} color={theme.color.onSurface} />
          <Text style={{ flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: "600" }}>Codes promo plateforme</Text>
          <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>
      )}
      <PromosManager visible={showPromos} onClose={() => setShowPromos(false)} />
      {user.is_moderator && (
        <Pressable testID="open-drivers-admin" onPress={() => setShowAdmin(true)} style={[styles.menuGroup, { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg }]}>
          <Icon name="shield-account-outline" size={22} color={theme.color.onSurface} />
          <Text style={{ flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: "600" }}>Administration chauffeurs & documents</Text>
          <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>
      )}
      <DriversAdmin visible={showAdmin} onClose={() => setShowAdmin(false)} />
      {user.is_moderator && (
        <Pressable testID="open-payouts-admin" onPress={() => setShowPayouts(true)} style={[styles.menuGroup, { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg }]}>
          <Icon name="bank-transfer" size={22} color={theme.color.onSurface} />
          <Text style={{ flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: "600" }}>Versements partenaires</Text>
          <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>
      )}
      <PayoutsAdmin visible={showPayouts} onClose={() => setShowPayouts(false)} />
      {user.is_moderator && (
        <Pressable testID="open-api-manager" onPress={() => setShowApi(true)} style={[styles.menuGroup, { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg }]}>
          <Icon name="api" size={22} color={theme.color.onSurface} />
          <Text style={{ flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: "600" }}>Gestion des API</Text>
          <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>
      )}
      <ApiManager visible={showApi} onClose={() => setShowApi(false)} />
      {user.is_moderator && (
        <>
          <Pressable testID="open-admin-dashboard" onPress={() => setShowDash(true)} style={[styles.menuGroup, { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg }]}>
            <Icon name="view-dashboard-outline" size={22} color={theme.color.onSurface} />
            <Text style={{ flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: "600" }}>Tableau de bord</Text>
            <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
          </Pressable>
          <Pressable testID="open-commission-settings" onPress={() => setShowComm(true)} style={[styles.menuGroup, { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg }]}>
            <Icon name="percent-outline" size={22} color={theme.color.onSurface} />
            <Text style={{ flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: "600" }}>Commissions & Cashback</Text>
            <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
          </Pressable>
          <Pressable testID="open-dispatch-settings" onPress={() => setShowDispatch(true)} style={[styles.menuGroup, { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg }]}>
            <Icon name="radar" size={22} color={theme.color.onSurface} />
            <Text style={{ flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: "600" }}>Gestion des courses</Text>
            <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
          </Pressable>
        </>
      )}
      <AdminDashboard visible={showDash} onClose={() => setShowDash(false)} />
      <CommissionSettings visible={showComm} onClose={() => setShowComm(false)} />
      <DispatchSettings visible={showDispatch} onClose={() => setShowDispatch(false)} />
      {user.is_moderator && (
        <Pressable testID="open-cities-moderation" onPress={() => setShowCities(true)} style={[styles.menuGroup, { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg }]}>
          <Icon name="city-variant-outline" size={22} color={theme.color.onSurface} />
          <Text style={{ flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: "600" }}>Modération des centres-villes</Text>
          <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>
      )}
      <CitiesModeration visible={showCities} onClose={() => setShowCities(false)} />

{user.is_moderator && (
        <Pressable testID="open-catalog-admin" onPress={() => setShowCatalog(true)} style={[styles.menuGroup, { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg }]}>
          <Icon name="cash-multiple" size={22} color={theme.color.onSurface} />
          <Text style={{ flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: "600" }}>Grille tarifaire & photos véhicules</Text>
          <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>
      )}
      <CatalogAdmin visible={showCatalog} onClose={() => setShowCatalog(false)} />


<Pressable testID="logout-button" style={styles.logout} onPress={doLogout}>
        <Icon name="logout" size={20} color={theme.color.error} />
        <Text style={styles.logoutText}>{t("logout")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 32, fontWeight: "800", color: theme.color.onSurface, marginBottom: theme.spacing.lg, letterSpacing: -1 },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.lg, padding: theme.spacing.xl, alignItems: "center", marginBottom: theme.spacing.xl },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.md },
  avatarText: { color: theme.color.onBrand, fontSize: 28, fontWeight: "800" },
  name: { fontSize: 20, fontWeight: "800", color: theme.color.onSurface },
  email: { fontSize: 14, color: theme.color.onSurfaceSecondary, marginTop: 4 },
  stats: { flexDirection: "row", marginTop: theme.spacing.lg, backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, alignSelf: "stretch" },
  stat: { flex: 1, alignItems: "center", gap: 4 },
  statValue: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface },
  statLabel: { fontSize: 12, color: theme.color.onSurfaceTertiary },
  divider: { width: 1, backgroundColor: theme.color.border, marginHorizontal: theme.spacing.md },
  menuGroup: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, overflow: "hidden", marginBottom: theme.spacing.xl },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surfaceSecondary, height: 52, borderRadius: theme.radius.pill },
  logoutText: { color: theme.color.error, fontWeight: "700", fontSize: 15 },
});

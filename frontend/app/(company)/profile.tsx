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
import PromosManager from "@/src/components/PromosManager";
import PartnerCommissions from "@/src/components/company/PartnerCommissions";
import WalletCard from "@/src/components/WalletCard";
import PhoneVerifyCard from "@/src/components/PhoneVerifyCard";
import AccountSection from "@/src/components/AccountSection";
import LanguagePicker from "@/src/components/LanguagePicker";

export default function CompanyProfile() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [showCities, setShowCities] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showPayouts, setShowPayouts] = useState(false);
  const [showPromos, setShowPromos] = useState(false);
  const [showCommissions, setShowCommissions] = useState(false);

  if (!user) return null;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.color.surface }} testID="company-profile"
      contentContainerStyle={{ paddingTop: insets.top + theme.spacing.lg, paddingBottom: insets.bottom + theme.spacing.xxl, paddingHorizontal: theme.spacing.xl }}>
      <Text style={styles.title} maxFontSizeMultiplier={1.3} numberOfLines={1} adjustsFontSizeToFit>{t("company")}</Text>
      <View style={styles.card}>
        <View style={styles.avatar}><Icon name="office-building" size={32} color="#fff" /></View>
        <Text style={styles.name}>{user.company_name}</Text>
        <Text style={styles.email}>Responsable : {user.full_name} · {user.email}</Text>
        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>Code d'invitation employés</Text>
          <Text style={styles.code} testID="company-invite-code">{user.invite_code}</Text>
          <Text style={styles.codeHint}>À saisir par vos employés dans l'app passager → Profil → Compte professionnel</Text>
        </View>
      </View>

      <View style={styles.info}>
        <Icon name="information-outline" size={18} color={theme.color.onSurfaceSecondary} />
        <Text style={styles.infoText}>Chaque employé réserve en autonomie dans la limite de son budget (jour, semaine ou mois). Vous suivez coûts, trajets et horaires en temps réel et exportez les relevés mensuels.</Text>
      </View>

      <WalletCard />
      <Pressable testID="open-commissions" onPress={() => setShowCommissions(true)} style={styles.menu}>
        <Icon name="cash-multiple" size={22} color={theme.color.onSurface} />
        <Text style={styles.menuLabel}>Commissions & versements</Text>
        <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
      </Pressable>
      <PartnerCommissions visible={showCommissions} onClose={() => setShowCommissions(false)} />
      <PhoneVerifyCard />
      <LanguagePicker />
      <AccountSection />

      <Pressable testID="open-promos" onPress={() => setShowPromos(true)} style={styles.menu}>
        <Icon name="ticket-percent-outline" size={22} color={theme.color.onSurface} />
        <Text style={styles.menuLabel}>Codes promo employés</Text>
        <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
      </Pressable>
      <PromosManager visible={showPromos} onClose={() => setShowPromos(false)} />
      {user.is_moderator && (
        <Pressable testID="open-payouts-admin" onPress={() => setShowPayouts(true)} style={styles.menu}>
          <Icon name="bank-transfer" size={22} color={theme.color.onSurface} />
          <Text style={styles.menuLabel}>Versements partenaires</Text>
          <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>
      )}
      <PayoutsAdmin visible={showPayouts} onClose={() => setShowPayouts(false)} />
      {user.is_moderator && (
        <Pressable testID="open-drivers-admin" onPress={() => setShowAdmin(true)} style={styles.menu}>
          <Icon name="shield-account-outline" size={22} color={theme.color.onSurface} />
          <Text style={styles.menuLabel}>Administration chauffeurs & documents</Text>
          <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>
      )}
      <DriversAdmin visible={showAdmin} onClose={() => setShowAdmin(false)} />
      {user.is_moderator && (
        <Pressable testID="open-cities-moderation" onPress={() => setShowCities(true)} style={styles.menu}>
          <Icon name="city-variant-outline" size={22} color={theme.color.onSurface} />
          <Text style={styles.menuLabel}>Modération des centres-villes</Text>
          <Icon name="chevron-right" size={20} color={theme.color.onSurfaceTertiary} />
        </Pressable>
      )}
      <CitiesModeration visible={showCities} onClose={() => setShowCities(false)} />

      <Pressable testID="logout-button" style={styles.logout} onPress={async () => { await logout(); router.replace("/(auth)/welcome"); }}>
        <Icon name="logout" size={20} color={theme.color.error} />
        <Text style={styles.logoutText}>{t("logout")}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 32, fontWeight: "800", color: theme.color.onSurface, marginBottom: theme.spacing.lg, letterSpacing: -1 },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.lg, padding: theme.spacing.xl, alignItems: "center", marginBottom: theme.spacing.lg },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center", marginBottom: theme.spacing.md },
  name: { fontSize: 20, fontWeight: "800", color: theme.color.onSurface },
  email: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 4, textAlign: "center" },
  codeBox: { marginTop: theme.spacing.lg, backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: theme.spacing.lg, alignSelf: "stretch", alignItems: "center" },
  codeLabel: { fontSize: 12, color: theme.color.onSurfaceTertiary, fontWeight: "600" },
  code: { fontSize: 28, fontWeight: "800", color: theme.color.onSurface, letterSpacing: 4, marginVertical: 4 },
  codeHint: { fontSize: 11, color: theme.color.onSurfaceTertiary, textAlign: "center" },
  info: { flexDirection: "row", gap: theme.spacing.sm, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.lg },
  infoText: { flex: 1, fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 18 },
  menu: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.lg, marginBottom: theme.spacing.lg },
  menuLabel: { flex: 1, fontSize: 15, color: theme.color.onSurface, fontWeight: "600" },
  logout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surfaceSecondary, height: 52, borderRadius: theme.radius.pill },
  logoutText: { color: theme.color.error, fontWeight: "700", fontSize: 15 },
});

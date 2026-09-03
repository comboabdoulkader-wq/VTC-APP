import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, Image } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { money, VEHICLE_ICON } from "@/src/utils/format";

export type VehicleOption = {
  vehicle_type: string; label: string; price: number; distance_km: number; duration_min: number; eta_min: number;
  category?: string; description?: string; image_url?: string; passengers?: number; luggage?: number; fits?: boolean;
  fixed_price?: boolean; fixed_route_name?: string | null; hourly_rate?: number | null;
};

/** Vehicle card: photo, capacity (passengers / luggage), category, price with fixed-price badge. */
export default function VehicleCard({ option, active, hours, onPress }: { option: VehicleOption; active: boolean; hours: number; onPress: () => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  const { t } = useI18n();
  const fits = option.fits !== false;
  return (
    <Pressable testID={`vehicle-${option.vehicle_type}`} onPress={onPress} disabled={!fits} style={[styles.card, active && styles.cardActive, !fits && styles.cardDisabled]} accessibilityState={{ selected: active, disabled: !fits }}>
      <View style={styles.imageWrap}>
        {option.image_url && !imgFailed ? (
          <Image source={{ uri: option.image_url }} style={styles.image} resizeMode="cover" onError={() => setImgFailed(true)} accessibilityLabel={option.label} />
        ) : (
          <Icon name={(VEHICLE_ICON[option.vehicle_type] || "car") as any} size={34} color={theme.color.onSurface} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.titleRow}>
          <Text style={styles.name}>{option.label}</Text>
          {option.category ? <Text style={styles.category}>{option.category}</Text> : null}
        </View>
        <View style={styles.capRow}>
          <Icon name="account-multiple" size={14} color={theme.color.onSurfaceSecondary} /><Text style={styles.cap}>{option.passengers ?? 3}</Text>
          <Icon name="bag-suitcase" size={14} color={theme.color.onSurfaceSecondary} style={{ marginLeft: 6 }} /><Text style={styles.cap}>{option.luggage ?? 3}</Text>
          <Text style={styles.meta}> · {hours ? t("hours_available", { h: hours }) : `${t("wait_min", { m: option.eta_min })} · ${option.duration_min} min · ${option.distance_km.toFixed(1)} km`}</Text>
        </View>
        {!fits ? (
          <Text style={styles.noFit} testID={`vehicle-${option.vehicle_type}-nofit`}>{t("not_fit")}</Text>
        ) : option.fixed_price ? (
          <View style={styles.badge} testID={`vehicle-${option.vehicle_type}-fixed`}><Icon name="lock-check-outline" size={12} color={theme.color.success} /><Text style={styles.badgeText}>{t("fixed_price")}</Text></View>
        ) : option.hourly_rate ? (
          <Text style={styles.desc}>{money(option.hourly_rate)} {t("per_hour")}</Text>
        ) : option.description ? (
          <Text style={styles.desc} numberOfLines={1}>{option.description}</Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={styles.price}>{money(option.price)}</Text>
        <Text style={styles.taxes}>{t("taxes_incl")}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, padding: theme.spacing.md, borderRadius: theme.radius.md, borderWidth: 2, borderColor: theme.color.border, backgroundColor: theme.color.surface },
  cardActive: { borderColor: theme.color.brand, backgroundColor: theme.color.surfaceSecondary },
  cardDisabled: { opacity: 0.55 },
  imageWrap: { width: 84, height: 56, borderRadius: theme.radius.sm, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  image: { width: "100%", height: "100%" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  name: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  category: { fontSize: 10, fontWeight: "800", color: theme.color.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 0.5 },
  capRow: { flexDirection: "row", alignItems: "center", marginTop: 3, flexWrap: "wrap" },
  cap: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginLeft: 2, fontWeight: "600" },
  meta: { fontSize: 12, color: theme.color.onSurfaceTertiary },
  desc: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 3 },
  noFit: { fontSize: 12, color: theme.color.error, marginTop: 3, fontWeight: "600" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4, alignSelf: "flex-start", backgroundColor: "#E6F4EC", paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill },
  badgeText: { fontSize: 11, fontWeight: "700", color: theme.color.success },
  price: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  taxes: { fontSize: 10, color: theme.color.onSurfaceTertiary },
});

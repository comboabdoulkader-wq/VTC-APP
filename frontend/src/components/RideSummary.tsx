import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useI18n } from "@/src/i18n";

type Flight = { number: string; airline?: string | null; status?: string | null; arrival_delay_min?: number | null; arrival_terminal?: string | null; arrival_estimated?: string | null; arrival_airport?: string | null; tracking_error?: string | null; checked_at?: string | null };

const FLIGHT_STATUS: Record<string, string> = { scheduled: "Prévu", active: "En vol", landed: "Atterri", cancelled: "Annulé", incident: "Incident", diverted: "Détourné" };

const fmtTime = (iso?: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};

/** Booking reference, service, passengers/luggage and flight card shown on the ride detail (passenger & driver). */
export default function RideSummary({ ride, compact }: { ride: any; compact?: boolean }) {
  const { t, lang } = useI18n();
  const f: Flight | null = ride.flight || null;
  const pax = (ride.passengers || 1) + (ride.children || 0);
  return (
    <View style={styles.wrap} testID="ride-summary">
      <View style={styles.row}>
        {ride.booking_ref ? (
          <View style={styles.refPill} testID="booking-ref"><Icon name="ticket-confirmation-outline" size={14} color={theme.color.onSurface} /><Text style={styles.refText}>{ride.booking_ref}</Text></View>
        ) : null}
        <Text style={styles.service}>{(lang !== "fr" && ride.service_labels?.[lang]) || ride.service_label || t("tab_home")}{ride.hours ? ` · ${ride.hours} h` : ""}</Text>
      </View>
      <View style={[styles.row, { marginTop: 6 }]}>
        <Icon name="account-multiple" size={15} color={theme.color.onSurfaceSecondary} /><Text style={styles.meta}>{t("passengers_n", { n: pax })}</Text>
        {ride.child_seats ? <><Icon name="car-child-seat" size={15} color={theme.color.onSurfaceSecondary} /><Text style={styles.meta}>{t("seats_n", { n: ride.child_seats })}</Text></> : null}
        <Icon name="bag-suitcase" size={15} color={theme.color.onSurfaceSecondary} /><Text style={styles.meta}>{t("luggage_n", { n: ride.luggage || 0 })}</Text>
        {ride.fixed_price ? <Text style={styles.fixed}>{t("fixed_price_short")}</Text> : null}
      </View>
      {f && f.number ? (
        <View style={styles.flight} testID="flight-card">
          <Icon name="airplane-landing" size={18} color={theme.color.onSurface} />
          <View style={{ flex: 1 }}>
            <Text style={styles.flightTitle} numberOfLines={1}>Vol {f.number}{f.airline ? ` · ${f.airline}` : ""}</Text>
            <Text style={styles.flightMeta} numberOfLines={2}>
              {f.status
                ? `${FLIGHT_STATUS[f.status] || f.status}${f.arrival_delay_min ? ` · retard ${f.arrival_delay_min} min` : f.status !== "cancelled" ? " · à l'heure" : ""}${fmtTime(f.arrival_estimated) ? ` · arrivée ${fmtTime(f.arrival_estimated)}` : ""}${f.arrival_terminal ? ` · T${f.arrival_terminal}` : ""}`
                : compact ? "Suivi indisponible – saisie manuelle" : "Suivi de vol indisponible – le chauffeur est informé de votre vol"}
            </Text>
          </View>
          {f.arrival_delay_min && f.arrival_delay_min > 0 ? <View style={styles.delay}><Text style={styles.delayText}>+{f.arrival_delay_min} min</Text></View> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: theme.spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  refPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.color.surfaceSecondary, paddingHorizontal: 10, height: 26, borderRadius: theme.radius.pill },
  refText: { fontSize: 12, fontWeight: "800", color: theme.color.onSurface, letterSpacing: 1 },
  service: { fontSize: 13, fontWeight: "700", color: theme.color.onSurfaceSecondary },
  meta: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginRight: 6 },
  fixed: { fontSize: 11, fontWeight: "800", color: theme.color.success },
  flight: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginTop: theme.spacing.sm },
  flightTitle: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  flightMeta: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  delay: { backgroundColor: "#FFF1E6", paddingHorizontal: 8, height: 24, borderRadius: theme.radius.pill, justifyContent: "center" },
  delayText: { fontSize: 12, fontWeight: "800", color: theme.color.warning },
});

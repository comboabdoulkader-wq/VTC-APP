import React from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Platform } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import type { Service } from "@/src/components/passenger/ServicePicker";

export type TripDetailsValue = { passengers: number; children: number; childSeats: number; luggage: number; hours: number; flightNumber: string; airline: string };
export const DEFAULT_TRIP: TripDetailsValue = { passengers: 1, children: 0, childSeats: 0, luggage: 0, hours: 0, flightNumber: "", airline: "" };
const SheetInput: any = Platform.OS === "web" ? TextInput : BottomSheetTextInput;

type Props = { value: TripDetailsValue; onChange: (v: TripDetailsValue) => void; service: Service | null; flightTracking: boolean };

/** Passengers / children / child seats / luggage steppers, hours for hourly services, flight for airport transfers. */
export default function TripDetails({ value, onChange, service, flightTracking }: Props) {
  const set = (patch: Partial<TripDetailsValue>) => onChange({ ...value, ...patch });
  const hourly = service?.pricing === "hourly";
  const airport = service?.key === "airport";
  const minHours = service?.min_hours || 2;

  return (
    <View style={styles.card} testID="trip-details">
      <Text style={styles.title}>Détails du trajet</Text>
      <Stepper testID="pax" icon="account" label="Adultes" value={value.passengers} min={1} max={16} onChange={(n) => set({ passengers: n })} />
      <Stepper testID="children" icon="human-child" label="Enfants" value={value.children} min={0} max={10} onChange={(n) => set({ children: n, childSeats: Math.min(value.childSeats, n) })} />
      {value.children > 0 && <Stepper testID="seats" icon="car-child-seat" label="Sièges bébé / enfant" value={value.childSeats} min={0} max={Math.min(4, value.children)} onChange={(n) => set({ childSeats: n })} />}
      <Stepper testID="luggage" icon="bag-suitcase" label="Bagages" value={value.luggage} min={0} max={20} onChange={(n) => set({ luggage: n })} last={!hourly && !airport} />

      {hourly && (
        <Stepper testID="hours" icon="clock-outline" label={`Durée (min. ${minHours} h)`} value={Math.max(value.hours, minHours)} min={minHours} max={24} suffix=" h" onChange={(n) => set({ hours: n })} last />
      )}

      {airport && (
        <View style={styles.flightBox} testID="flight-box">
          <View style={styles.flightHead}>
            <Icon name="airplane-landing" size={18} color={theme.color.onSurface} />
            <Text style={styles.flightTitle}>Votre vol</Text>
            <Text style={styles.flightHint}>{flightTracking ? "Suivi en temps réel" : "Saisie manuelle"}</Text>
          </View>
          <View style={styles.flightRow}>
            <SheetInput
              testID="flight-number"
              value={value.flightNumber}
              onChangeText={(t: string) => set({ flightNumber: t.toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 8) })}
              autoCapitalize="characters"
              placeholder="N° de vol (AF1234)"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={[styles.input, { flex: 1 }]}
            />
            <SheetInput
              testID="airline"
              value={value.airline}
              onChangeText={(t: string) => set({ airline: t.slice(0, 40) })}
              placeholder="Compagnie"
              placeholderTextColor={theme.color.onSurfaceTertiary}
              style={[styles.input, { flex: 1 }]}
            />
          </View>
          <Text style={styles.flightNote}>
            {flightTracking
              ? "Votre chauffeur suit votre vol : en cas de retard, la prise en charge est décalée automatiquement."
              : "Indiquez votre vol : le chauffeur en est informé et adapte la prise en charge."}
          </Text>
        </View>
      )}
    </View>
  );
}

function Stepper({ icon, label, value, min, max, onChange, suffix = "", last, testID }: { icon: string; label: string; value: number; min: number; max: number; onChange: (n: number) => void; suffix?: string; last?: boolean; testID: string }) {
  return (
    <View style={[styles.row, last && { borderBottomWidth: 0 }]}>
      <Icon name={icon as any} size={20} color={theme.color.onSurfaceSecondary} />
      <Text style={styles.label}>{label}</Text>
      <Pressable testID={`${testID}-minus`} onPress={() => onChange(Math.max(min, value - 1))} disabled={value <= min} style={[styles.btn, value <= min && { opacity: 0.3 }]} hitSlop={6}>
        <Icon name="minus" size={18} color={theme.color.onSurface} />
      </Pressable>
      <Text style={styles.value} testID={`${testID}-value`}>{value}{suffix}</Text>
      <Pressable testID={`${testID}-plus`} onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max} style={[styles.btn, value >= max && { opacity: 0.3 }]} hitSlop={6}>
        <Icon name="plus" size={18} color={theme.color.onSurface} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md, marginBottom: theme.spacing.lg },
  title: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface, marginBottom: theme.spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, minHeight: 48, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  label: { flex: 1, fontSize: 14, color: theme.color.onSurface },
  btn: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.color.border },
  value: { minWidth: 34, textAlign: "center", fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  flightBox: { paddingVertical: theme.spacing.md },
  flightHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  flightTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  flightHint: { fontSize: 11, fontWeight: "700", color: theme.color.onSurfaceTertiary, textTransform: "uppercase" },
  flightRow: { flexDirection: "row", gap: theme.spacing.sm },
  input: { backgroundColor: theme.color.surface, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing.md, height: 44, fontSize: 14, color: theme.color.onSurface, borderWidth: 1, borderColor: theme.color.border },
  flightNote: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.sm, lineHeight: 16 },
});

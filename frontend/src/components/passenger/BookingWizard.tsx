import { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import DateTimeChips from "@/src/components/ui/DateTimeChips";
import { fmtDateTime } from "@/src/utils/format";

const STEPS = [
  { icon: "web", label: "Connexion" },
  { icon: "car", label: "Type de course" },
  { icon: "clock-outline", label: "Réservation" },
  { icon: "map-marker-radius", label: "Destination" },
];

function Stepper({ current }: { current: number }) {
  return (
    <View style={styles.stepper}>
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <View key={s.label} style={styles.stepItem}>
            <View style={[styles.stepDot, active && styles.stepDotActive, done && styles.stepDotDone]}>
              <Icon name={done ? "check" : (s.icon as any)} size={16} color={active || done ? "#fff" : theme.color.onSurfaceTertiary} />
            </View>
            <Text style={[styles.stepLabel, active && styles.stepLabelActive]} numberOfLines={1}>{s.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

type Props = {
  hasBusinessAccount: boolean;
  companyName?: string | null;
  initialBusiness: boolean;
  initialSchedule: Date | null;
  onDone: (business: boolean, schedule: Date | null) => void;
};

export default function BookingWizard({ hasBusinessAccount, companyName, initialBusiness, initialSchedule, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<0 | 1>(0);
  const [business, setBusiness] = useState(initialBusiness);
  const [mode, setMode] = useState<"now" | "scheduled">(initialSchedule ? "scheduled" : "now");
  const [schedule, setSchedule] = useState<Date | null>(initialSchedule);

  const canContinue = step === 0 ? true : (mode === "now" || !!schedule);

  const next = () => {
    if (step === 0) { setStep(1); return; }
    onDone(business, mode === "scheduled" ? schedule : null);
  };

  return (
    <View style={styles.overlay} testID="booking-wizard">
      <View style={[styles.scrim, { paddingTop: insets.top + theme.spacing.xl }]}>
        <View style={styles.brand}>
          <Text style={styles.brandName}>RideGo</Text>
          <Text style={styles.brandSub}>Réservez en 3 étapes</Text>
        </View>
      </View>

      <View style={[styles.card, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
        <Stepper current={step + 1} />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {step === 0 ? (
            <>
              <Text style={styles.title}>Type de course</Text>
              <Text style={styles.subtitle}>Comment souhaitez-vous réserver ?</Text>
              <Pressable testID="wizard-type-private" onPress={() => setBusiness(false)} style={[styles.option, !business && styles.optionActive]}>
                <View style={[styles.optIcon, { backgroundColor: "#EEF2FF" }]}><Icon name="account" size={24} color="#4F46E5" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optTitle}>Privée</Text>
                  <Text style={styles.optMeta}>Course personnelle, payée par vous</Text>
                </View>
                {!business && <Icon name="check-circle" size={22} color={theme.color.success} />}
              </Pressable>
              <Pressable testID="wizard-type-business" disabled={!hasBusinessAccount} onPress={() => setBusiness(true)}
                style={[styles.option, business && styles.optionActive, !hasBusinessAccount && styles.optionDisabled]}>
                <View style={[styles.optIcon, { backgroundColor: "#ECFDF5" }]}><Icon name="office-building" size={24} color="#059669" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optTitle}>Professionnelle</Text>
                  <Text style={styles.optMeta}>
                    {hasBusinessAccount ? `Facturée à ${companyName || "votre entreprise"}` : "Aucun compte professionnel lié"}
                  </Text>
                </View>
                {!hasBusinessAccount ? <Icon name="lock-outline" size={20} color={theme.color.onSurfaceTertiary} />
                  : business ? <Icon name="check-circle" size={22} color={theme.color.success} /> : null}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.title}>Réservation</Text>
              <Text style={styles.subtitle}>Quand souhaitez-vous partir ?</Text>
              <Pressable testID="wizard-when-now" onPress={() => { setMode("now"); setSchedule(null); }} style={[styles.option, mode === "now" && styles.optionActive]}>
                <View style={[styles.optIcon, { backgroundColor: "#FFF7ED" }]}><Icon name="lightning-bolt" size={24} color="#EA580C" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optTitle}>Immédiate</Text>
                  <Text style={styles.optMeta}>Un chauffeur vient vous chercher maintenant</Text>
                </View>
                {mode === "now" && <Icon name="check-circle" size={22} color={theme.color.success} />}
              </Pressable>
              <Pressable testID="wizard-when-scheduled" onPress={() => setMode("scheduled")} style={[styles.option, mode === "scheduled" && styles.optionActive]}>
                <View style={[styles.optIcon, { backgroundColor: "#F5F3FF" }]}><Icon name="calendar-clock" size={24} color="#7C3AED" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optTitle}>Programmée</Text>
                  <Text style={styles.optMeta}>{schedule ? fmtDateTime(schedule) : "Choisissez la date et l'heure"}</Text>
                </View>
                {mode === "scheduled" && <Icon name="check-circle" size={22} color={theme.color.success} />}
              </Pressable>
              {mode === "scheduled" && (
                <View style={styles.dtWrap} testID="wizard-datetime">
                  <DateTimeChips value={schedule} onChange={setSchedule} allowNow={false} />
                </View>
              )}
            </>
          )}
        </ScrollView>

        <View style={styles.footer}>
          {step === 1 && (
            <Pressable testID="wizard-back" onPress={() => setStep(0)} style={styles.backBtn}>
              <Icon name="chevron-left" size={22} color={theme.color.onSurface} />
              <Text style={styles.backText}>Retour</Text>
            </Pressable>
          )}
          <Pressable testID="wizard-continue" onPress={next} disabled={!canContinue} style={[styles.nextBtn, !canContinue && { opacity: 0.5 }]}>
            <Text style={styles.nextText}>{step === 0 ? "Continuer" : "Choisir la destination"}</Text>
            <Icon name="chevron-right" size={22} color="#fff" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 50, elevation: 50, backgroundColor: theme.color.brand },
  scrim: { flex: 1, alignItems: "center", justifyContent: "flex-start" },
  brand: { alignItems: "center", gap: 4 },
  brandName: { fontSize: 34, fontWeight: "900", color: "#fff", letterSpacing: 0.5 },
  brandSub: { fontSize: 14, color: "rgba(255,255,255,0.85)", fontWeight: "600" },
  card: { backgroundColor: theme.color.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: theme.spacing.lg, width: "100%", maxWidth: 640, alignSelf: "center", maxHeight: "78%" },
  stepper: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: theme.spacing.lg, marginBottom: theme.spacing.md },
  stepItem: { flex: 1, alignItems: "center", gap: 6 },
  stepDot: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  stepDotActive: { backgroundColor: theme.color.brand },
  stepDotDone: { backgroundColor: theme.color.success },
  stepLabel: { fontSize: 10, fontWeight: "700", color: theme.color.onSurfaceTertiary, textAlign: "center" },
  stepLabelActive: { color: theme.color.onSurface },
  body: { paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.md },
  title: { fontSize: 22, fontWeight: "800", color: theme.color.onSurface, marginTop: theme.spacing.sm },
  subtitle: { fontSize: 14, color: theme.color.onSurfaceSecondary, marginTop: 4, marginBottom: theme.spacing.lg },
  option: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, padding: theme.spacing.md, borderRadius: theme.radius.md, borderWidth: 2, borderColor: theme.color.border, backgroundColor: theme.color.surface, marginBottom: theme.spacing.md },
  optionActive: { borderColor: theme.color.success, backgroundColor: "#F2FAF5" },
  optionDisabled: { opacity: 0.55 },
  optIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  optTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  optMeta: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  dtWrap: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md },
  footer: { flexDirection: "row", gap: theme.spacing.md, paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.sm },
  backBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: 54, paddingHorizontal: theme.spacing.lg, borderRadius: theme.radius.pill, borderWidth: 1.5, borderColor: theme.color.borderStrong },
  backText: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  nextBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, height: 54, borderRadius: theme.radius.pill, backgroundColor: theme.color.brand },
  nextText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});

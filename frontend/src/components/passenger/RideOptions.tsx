import React from "react";
import { View, Text, StyleSheet, Pressable, Switch, Platform, TextInput } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import DateTimeChips from "@/src/components/ui/DateTimeChips";
import { money } from "@/src/utils/format";
import { apiFetch, useAuth } from "@/src/context/auth";

// BottomSheetTextInput relies on native TextInput.State APIs that don't exist on web.
const SheetInput: any = Platform.OS === "web" ? TextInput : BottomSheetTextInput;

export type Budget = { company: string; active: boolean; budget_amount: number | null; budget_period: "day" | "week" | "month"; spent: number; remaining: number | null };
const PERIOD_FR = { day: "jour", week: "semaine", month: "mois" };

export type Surcharge = { distance_to_center_km: number; per_km: number; amount: number; center_name: string };

export type RideOptionsValue = {
  surchargeEnabled: boolean;
  scheduledAt: Date | null;
  forOther: boolean;
  passengerLabel: string;
  notes: string;
  paymentMethod: "cash" | "card";
  business: boolean;
  promoCode: string;
  discount: number;
};

export const DEFAULT_OPTIONS: RideOptionsValue = {
  surchargeEnabled: false, scheduledAt: null, forOther: false, passengerLabel: "", notes: "", paymentMethod: "cash", business: false, promoCode: "", discount: 0,
};

type Props = {
  value: RideOptionsValue;
  onChange: (v: RideOptionsValue) => void;
  surcharge: Surcharge | null;
  basePrice: number;
  cardEnabled: boolean;
  budget?: Budget | null;
};

export default function RideOptions({ value, onChange, surcharge, basePrice, cardEnabled, budget }: Props) {
  const set = (patch: Partial<RideOptionsValue>) => onChange({ ...value, ...patch });
  const { token } = useAuth();
  const [promoInput, setPromoInput] = React.useState("");
  const [promoError, setPromoError] = React.useState<string | null>(null);
  const subtotal = basePrice + (value.surchargeEnabled && surcharge ? surcharge.amount : 0);
  const total = Math.max(subtotal - (value.promoCode ? value.discount : 0), 0);
  const applyPromo = async () => {
    setPromoError(null);
    try {
      const r = await apiFetch<any>("/promos/validate", { method: "POST", body: JSON.stringify({ code: promoInput, price: subtotal }) }, token);
      set({ promoCode: r.code, discount: r.discount });
    } catch (e: any) { setPromoError(e.message); set({ promoCode: "", discount: 0 }); }
  };

  return (
    <View>
      {/* Rallonge */}
      {surcharge && surcharge.amount < 0.5 && (
        <View style={styles.centerInfo} testID="surcharge-none">
          <Icon name="city-variant-outline" size={16} color={theme.color.onSurfaceSecondary} />
          <Text style={styles.centerInfoText}>Départ en centre-ville ({surcharge.center_name}) : aucune rallonge nécessaire.</Text>
        </View>
      )}
      {surcharge && surcharge.amount >= 0.5 && (
        <View style={[styles.card, value.surchargeEnabled && styles.cardActive]} testID="surcharge-card">
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.md }}>
            <View style={styles.cardIcon}><Icon name="map-marker-distance" size={22} color={theme.color.onSurface} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Rallonge chauffeur éloigné</Text>
              <Text style={styles.cardMeta}>
                {surcharge.distance_to_center_km.toFixed(1)} km du centre ({surcharge.center_name}) × {money(surcharge.per_km)}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text style={styles.cardPrice}>+{money(surcharge.amount)}</Text>
              <Switch
                testID="surcharge-switch"
                value={value.surchargeEnabled}
                onValueChange={(v) => set({ surchargeEnabled: v })}
                trackColor={{ true: theme.color.success, false: theme.color.borderStrong }}
                thumbColor="#fff"
              />
            </View>
          </View>
          <Text style={styles.cardHint}>
            Option facultative : ce supplément rend votre course plus attractive et augmente vos chances de trouver un chauffeur rapidement.
          </Text>
        </View>
      )}

      {/* Quand */}
      <Text style={styles.label}><Icon name="clock-outline" size={14} /> Quand ?</Text>
      <DateTimeChips value={value.scheduledAt} onChange={(d) => set({ scheduledAt: d })} />

      {/* Pour qui */}
      <Text style={styles.label}><Icon name="account-multiple-outline" size={14} /> Pour qui ?</Text>
      <View style={styles.chips}>
        <Pressable testID="for-me" onPress={() => set({ forOther: false, passengerLabel: "" })} style={[styles.chip, !value.forOther && styles.chipActive]}>
          <Text style={[styles.chipText, !value.forOther && styles.chipTextActive]}>Pour moi</Text>
        </Pressable>
        <Pressable testID="for-other" onPress={() => set({ forOther: true })} style={[styles.chip, value.forOther && styles.chipActive]}>
          <Text style={[styles.chipText, value.forOther && styles.chipTextActive]}>Pour un proche</Text>
        </Pressable>
      </View>
      {value.forOther && (
        <SheetInput
          testID="passenger-label-input"
          value={value.passengerLabel}
          onChangeText={(t: string) => set({ passengerLabel: t })}
          placeholder="Nom du passager (ex. Maman, M. Martin)"
          placeholderTextColor={theme.color.onSurfaceTertiary}
          style={styles.input}
        />
      )}

      {/* Course professionnelle */}
      {budget && budget.active && (
        <>
          <Text style={styles.label}><Icon name="briefcase-outline" size={14} /> Déplacement professionnel</Text>
          <Pressable testID="business-toggle" onPress={() => set({ business: !value.business, paymentMethod: !value.business ? "cash" : value.paymentMethod })}
            style={[styles.card, { marginTop: 0 }, value.business && styles.cardActive]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.md }}>
              <View style={styles.cardIcon}><Icon name="office-building" size={22} color={theme.color.onSurface} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Facturer à {budget.company}</Text>
                <Text style={styles.cardMeta}>
                  {budget.remaining == null ? "Budget illimité" : `${money(budget.remaining)} restants ce ${PERIOD_FR[budget.budget_period]}`}
                </Text>
              </View>
              <Switch testID="business-switch" value={value.business} onValueChange={(v) => set({ business: v })} trackColor={{ true: theme.color.success, false: theme.color.borderStrong }} thumbColor="#fff" />
            </View>
            {value.business && budget.remaining != null && total > budget.remaining && (
              <Text style={[styles.cardHint, { color: theme.color.error, fontWeight: "700" }]}>Budget insuffisant pour cette course ({money(total)}).</Text>
            )}
          </Pressable>
        </>
      )}

      {/* Paiement */}
      <Text style={styles.label}><Icon name="wallet-outline" size={14} /> Paiement</Text>
      <View style={styles.chips}>
        <Pressable testID="pay-cash" onPress={() => set({ paymentMethod: "cash" })} style={[styles.chip, value.paymentMethod === "cash" && styles.chipActive]}>
          <Icon name="cash" size={16} color={value.paymentMethod === "cash" ? theme.color.onBrand : theme.color.onSurface} />
          <Text style={[styles.chipText, value.paymentMethod === "cash" && styles.chipTextActive]}>Espèces</Text>
        </Pressable>
        <Pressable
          testID="pay-card"
          disabled={!cardEnabled}
          onPress={() => set({ paymentMethod: "card" })}
          style={[styles.chip, value.paymentMethod === "card" && styles.chipActive, !cardEnabled && { opacity: 0.4 }]}
        >
          <Icon name="credit-card-outline" size={16} color={value.paymentMethod === "card" ? theme.color.onBrand : theme.color.onSurface} />
          <Text style={[styles.chipText, value.paymentMethod === "card" && styles.chipTextActive]}>Carte</Text>
        </Pressable>
      </View>

      {/* Code promo */}
      <Text style={styles.label}><Icon name="ticket-percent-outline" size={14} /> Code promo</Text>
      {value.promoCode ? (
        <View style={[styles.card, { marginTop: 0 }, styles.cardActive]} testID="promo-applied">
          <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.md }}>
            <Icon name="check-decagram" size={22} color={theme.color.success} />
            <Text style={[styles.cardTitle, { flex: 1 }]}>{value.promoCode} · −{money(value.discount)}</Text>
            <Pressable testID="promo-remove" onPress={() => { set({ promoCode: "", discount: 0 }); setPromoInput(""); }} hitSlop={8}><Icon name="close" size={20} color={theme.color.onSurfaceSecondary} /></Pressable>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", gap: theme.spacing.sm }}>
          <SheetInput testID="promo-input" value={promoInput} onChangeText={(t: string) => setPromoInput(t.toUpperCase())} placeholder="Entrez un code" autoCapitalize="characters" placeholderTextColor={theme.color.onSurfaceTertiary} style={[styles.input, { flex: 1, marginTop: 0 }]} />
          <Pressable testID="promo-apply" onPress={applyPromo} disabled={promoInput.length < 3} style={[styles.chip, { height: 48, backgroundColor: theme.color.brand }, promoInput.length < 3 && { opacity: 0.5 }]}><Text style={[styles.chipText, { color: "#fff" }]}>Appliquer</Text></Pressable>
        </View>
      )}
      {promoError ? <Text style={{ color: theme.color.error, fontSize: 12, marginTop: 4 }}>{promoError}</Text> : null}

      {/* Notes */}
      <Text style={styles.label}><Icon name="note-text-outline" size={14} /> Infos pour le chauffeur</Text>
      <SheetInput
        testID="notes-input"
        value={value.notes}
        onChangeText={(t: string) => set({ notes: t })}
        placeholder="Code porte, bagages, siège bébé…"
        placeholderTextColor={theme.color.onSurfaceTertiary}
        style={styles.input}
      />

      {/* Récap prix */}
      <View style={styles.total} testID="price-breakdown">
        <View style={styles.totalRow}><Text style={styles.totalLabel}>Course</Text><Text style={styles.totalVal}>{money(basePrice)}</Text></View>
        {value.surchargeEnabled && surcharge && (
          <View style={styles.totalRow}><Text style={styles.totalLabel}>Rallonge ({surcharge.distance_to_center_km.toFixed(1)} km)</Text><Text style={styles.totalVal}>+{money(surcharge.amount)}</Text></View>
        )}
        {value.promoCode ? <View style={styles.totalRow}><Text style={[styles.totalLabel, { color: theme.color.success }]}>Code {value.promoCode}</Text><Text style={[styles.totalVal, { color: theme.color.success }]}>−{money(value.discount)}</Text></View> : null}
        <View style={[styles.totalRow, styles.totalFinal]}>
          <Text style={styles.totalFinalLabel}>Total {value.scheduledAt ? "· programmée" : ""}{value.business ? " · pro" : ""}</Text>
          <Text style={styles.totalFinalVal}>{money(total)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centerInfo: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, marginTop: theme.spacing.lg, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md },
  centerInfoText: { flex: 1, fontSize: 12, color: theme.color.onSurfaceSecondary },
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginTop: theme.spacing.lg, borderWidth: 2, borderColor: "transparent" },
  cardActive: { borderColor: theme.color.success, backgroundColor: "#F2FAF5" },
  cardIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  cardMeta: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  cardPrice: { fontSize: 16, fontWeight: "800", color: theme.color.success },
  cardHint: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.sm, lineHeight: 17 },
  label: { fontSize: 13, fontWeight: "700", color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm, textTransform: "uppercase", letterSpacing: 0.4 },
  chips: { flexDirection: "row", gap: theme.spacing.sm, flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: theme.spacing.lg, height: 40, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary },
  chipActive: { backgroundColor: theme.color.brand },
  chipText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  chipTextActive: { color: theme.color.onBrand },
  input: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 48, fontSize: 15, color: theme.color.onSurface, marginTop: theme.spacing.sm },
  total: { marginTop: theme.spacing.xl, borderTopWidth: 1, borderTopColor: theme.color.divider, paddingTop: theme.spacing.md, gap: 6 },
  totalRow: { flexDirection: "row", justifyContent: "space-between" },
  totalLabel: { fontSize: 14, color: theme.color.onSurfaceSecondary },
  totalVal: { fontSize: 14, color: theme.color.onSurface, fontWeight: "600" },
  totalFinal: { marginTop: 4 },
  totalFinalLabel: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface },
  totalFinalVal: { fontSize: 20, fontWeight: "800", color: theme.color.onSurface },
});

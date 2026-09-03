import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { money } from "@/src/utils/format";

export type ReviewPayload = { rating: number; tip: number; comment?: string; punctuality?: number; cleanliness?: number; driving?: number; vehicle?: number };
const CRITERIA: { key: "punctuality" | "cleanliness" | "driving" | "vehicle"; label: string; icon: string }[] = [
  { key: "punctuality", label: "Ponctualité", icon: "clock-check-outline" },
  { key: "cleanliness", label: "Propreté", icon: "spray-bottle" },
  { key: "driving", label: "Conduite & courtoisie", icon: "steering" },
  { key: "vehicle", label: "Qualité du véhicule", icon: "car-info" },
];

/** Post-ride review: global stars, 4 detailed criteria, comment, tip. */
export default function ReviewForm({ paymentMethod, submitting, onSubmit }: { paymentMethod: string; submitting: boolean; onSubmit: (p: ReviewPayload) => void }) {
  const [rating, setRating] = useState(5);
  const [criteria, setCriteria] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [tip, setTip] = useState(0);

  const submit = () => onSubmit({ rating, tip, comment: comment.trim() || undefined, ...criteria });

  return (
    <View style={styles.box} testID="rating-box">
      <Text style={styles.title}>Comment s'est passée votre course ?</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} testID={`star-${n}`} onPress={() => setRating(n)} hitSlop={6}>
            <Icon name={n <= rating ? "star" : "star-outline"} size={40} color={theme.color.star} />
          </Pressable>
        ))}
      </View>

      {CRITERIA.map((c) => (
        <View key={c.key} style={styles.critRow} testID={`crit-${c.key}`}>
          <Icon name={c.icon as any} size={18} color={theme.color.onSurfaceSecondary} />
          <Text style={styles.critLabel}>{c.label}</Text>
          <View style={{ flexDirection: "row", gap: 2 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} testID={`crit-${c.key}-${n}`} onPress={() => setCriteria((p) => ({ ...p, [c.key]: n }))} hitSlop={4}>
                <Icon name={n <= (criteria[c.key] || 0) ? "star" : "star-outline"} size={22} color={criteria[c.key] ? theme.color.star : theme.color.borderStrong} />
              </Pressable>
            ))}
          </View>
        </View>
      ))}

      <TextInput
        testID="review-comment"
        value={comment}
        onChangeText={(t) => setComment(t.slice(0, 500))}
        placeholder="Un commentaire pour votre chauffeur ? (optionnel)"
        placeholderTextColor={theme.color.onSurfaceTertiary}
        multiline
        style={styles.comment}
      />

      <Text style={styles.tipLabel}>Ajouter un pourboire {paymentMethod === "card" ? "(payé par carte)" : "(remis en espèces)"}</Text>
      <View style={styles.tipRow}>
        {[0, 1, 2, 5, 10].map((t) => (
          <Pressable key={t} testID={`tip-${t}`} onPress={() => setTip(t)} style={[styles.tipChip, tip === t && styles.tipChipActive]}>
            <Text style={[styles.tipText, tip === t && { color: "#fff" }]}>{t === 0 ? "Aucun" : `${t} €`}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable testID="submit-rating" onPress={submit} disabled={submitting} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }, submitting && { opacity: 0.7 }]}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{tip > 0 ? `Envoyer et donner ${money(tip)}` : "Envoyer mon avis"}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.lg, padding: theme.spacing.lg, marginBottom: theme.spacing.lg },
  title: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, textAlign: "center" },
  stars: { flexDirection: "row", justifyContent: "center", gap: theme.spacing.sm, marginVertical: theme.spacing.md },
  critRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, minHeight: 40 },
  critLabel: { flex: 1, fontSize: 13, color: theme.color.onSurface },
  comment: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, padding: theme.spacing.md, minHeight: 64, fontSize: 14, color: theme.color.onSurface, marginTop: theme.spacing.md, borderWidth: 1, borderColor: theme.color.border, textAlignVertical: "top" },
  tipLabel: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm, fontWeight: "600" },
  tipRow: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  tipChip: { flex: 1, height: 40, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.color.border, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface },
  tipChipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  tipText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  primary: { backgroundColor: theme.color.brand, height: 52, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  primaryText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 15 },
});

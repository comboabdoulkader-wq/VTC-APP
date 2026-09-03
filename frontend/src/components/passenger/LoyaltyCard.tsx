import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";

type Level = { key: string; label: string; min_rides: number; reached: boolean };
type Data = { tier: string; label: string; completed: number; next_label: string | null; next_min: number | null; to_next: number; cashback_bonus: number; levels: Level[] };

const TIER_ICON: Record<string, string> = { bronze: "star-circle-outline", silver: "medal-outline", gold: "medal", platinum: "crown" };
const TIER_COLOR: Record<string, string> = { bronze: "#CD7F32", silver: "#B8B8C0", gold: "#E8B84B", platinum: "#7FB5FF" };

/** Passenger loyalty card: tier Bronze→Platine + progress, shown in the profile. */
export default function LoyaltyCard() {
  const { token } = useAuth();
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => { apiFetch<Data>("/loyalty", {}, token).then(setD).catch(() => setD(null)); }, [token]);
  if (!d) return null;

  const prevMin = d.next_min ? (d.levels.find((l) => l.label === d.label)?.min_rides ?? 0) : 0;
  const span = d.next_min ? Math.max(1, d.next_min - prevMin) : 1;
  const progress = d.next_min ? Math.min(100, Math.round(((d.completed - prevMin) / span) * 100)) : 100;

  return (
    <View style={styles.card} testID="loyalty-card">
      <View style={styles.head}>
        <Icon name={(TIER_ICON[d.tier] || "star") as any} size={26} color={TIER_COLOR[d.tier] || theme.color.onSurface} />
        <View style={{ flex: 1 }}>
          <Text style={styles.tier}>Niveau {d.label}</Text>
          <Text style={styles.sub}>{d.completed} course(s) terminée(s){d.cashback_bonus > 0 ? ` · cashback +${Math.round(d.cashback_bonus * 100)}%` : ""}</Text>
        </View>
      </View>

      <View style={styles.track}><View style={[styles.fill, { width: `${progress}%`, backgroundColor: TIER_COLOR[d.tier] || theme.color.brand }]} /></View>
      <Text style={styles.hint}>{d.next_label ? `Encore ${d.to_next} course(s) pour atteindre ${d.next_label} 🎯` : "Niveau maximum atteint 🎉"}</Text>

      <View style={styles.levels}>
        {d.levels.map((l) => (
          <View key={l.key} style={styles.level}>
            <Icon name={(TIER_ICON[l.key] || "star") as any} size={18} color={l.reached ? (TIER_COLOR[l.key] || theme.color.onSurface) : theme.color.borderStrong} />
            <Text style={[styles.levelLabel, l.reached && { color: theme.color.onSurface, fontWeight: "800" }]}>{l.label}</Text>
            <Text style={styles.levelMin}>{l.min_rides}+</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.lg, padding: theme.spacing.lg, marginBottom: theme.spacing.md },
  head: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  tier: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  sub: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  track: { height: 8, borderRadius: 4, backgroundColor: theme.color.surface, marginTop: theme.spacing.md, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  hint: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.sm },
  levels: { flexDirection: "row", justifyContent: "space-between", marginTop: theme.spacing.md },
  level: { alignItems: "center", gap: 2 },
  levelLabel: { fontSize: 11, color: theme.color.onSurfaceTertiary }, levelMin: { fontSize: 10, color: theme.color.onSurfaceTertiary },
});

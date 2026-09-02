import React, { useMemo } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";

import { theme } from "@/src/theme";

type Props = {
  value: Date | null;           // null = "now"
  onChange: (d: Date | null) => void;
  allowNow?: boolean;
  days?: number;
};

const DAY_LABELS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function sameDay(a: Date, b: Date) { return startOfDay(a).getTime() === startOfDay(b).getTime(); }

/** Ergonomic date/time chooser (day chips + 15-min time chips). Works on web + native. */
export default function DateTimeChips({ value, onChange, allowNow = true, days = 7 }: Props) {
  const now = new Date();
  const dayOptions = useMemo(() => Array.from({ length: days }, (_, i) => {
    const d = startOfDay(new Date()); d.setDate(d.getDate() + i);
    const label = i === 0 ? "Aujourd'hui" : i === 1 ? "Demain" : `${DAY_LABELS[d.getDay()]} ${d.getDate()}`;
    return { d, label };
  }), [days]);

  const selectedDay = value ? startOfDay(value) : null;

  const timeOptions = useMemo(() => {
    if (!selectedDay) return [];
    const out: Date[] = [];
    const base = new Date(selectedDay);
    const isToday = sameDay(selectedDay, now);
    let start = 0;
    if (isToday) {
      const mins = now.getHours() * 60 + now.getMinutes() + 30; // at least 30 min ahead
      start = Math.ceil(mins / 15) * 15;
    }
    for (let m = start; m < 24 * 60; m += 15) {
      const t = new Date(base); t.setMinutes(m); out.push(t);
    }
    return out;
  }, [selectedDay?.getTime()]);

  const pickDay = (d: Date) => {
    const t = new Date(d);
    if (sameDay(d, now)) {
      const mins = Math.ceil((now.getHours() * 60 + now.getMinutes() + 30) / 15) * 15;
      t.setMinutes(mins);
    } else t.setHours(9, 0, 0, 0);
    onChange(t);
  };

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {allowNow && (
          <Pressable testID="schedule-now" onPress={() => onChange(null)} style={[styles.chip, !value && styles.chipActive]}>
            <Text style={[styles.chipText, !value && styles.chipTextActive]}>Maintenant</Text>
          </Pressable>
        )}
        {dayOptions.map(({ d, label }) => {
          const active = !!selectedDay && sameDay(selectedDay, d);
          return (
            <Pressable key={label} testID={`schedule-day-${label}`} onPress={() => pickDay(d)} style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {value && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.row, { marginTop: theme.spacing.sm }]}>
          {timeOptions.map((t) => {
            const active = t.getTime() === value.getTime();
            const label = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
            return (
              <Pressable key={label} testID={`schedule-time-${label}`} onPress={() => onChange(t)} style={[styles.timeChip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: theme.spacing.sm, paddingRight: theme.spacing.lg },
  chip: { paddingHorizontal: theme.spacing.lg, height: 40, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  timeChip: { paddingHorizontal: theme.spacing.md, height: 36, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "transparent" },
  chipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  chipText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  chipTextActive: { color: theme.color.onBrand },
});

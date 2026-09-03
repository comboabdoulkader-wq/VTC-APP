import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";

export type Service = { key: string; label: string; label_en: string; icon: string; pricing: "distance" | "hourly"; min_hours: number; description: string };

/** Horizontal service selector (Airport, Private, Hourly, Business, City tour, Events, Long distance, Special). */
export default function ServicePicker({ services, value, onChange }: { services: Service[]; value: string; onChange: (s: Service) => void }) {
  const current = services.find((s) => s.key === value);
  return (
    <View style={styles.wrap} testID="service-picker">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
        {services.map((s) => {
          const active = s.key === value;
          return (
            <Pressable key={s.key} testID={`service-${s.key}`} onPress={() => onChange(s)} style={[styles.chip, active && styles.chipActive]} accessibilityState={{ selected: active }}>
              <Icon name={s.icon as any} size={18} color={active ? theme.color.onBrand : theme.color.onSurface} />
              <Text style={[styles.chipText, active && { color: theme.color.onBrand }]}>{s.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {current ? <Text style={styles.desc} testID="service-description">{current.description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: theme.spacing.md },
  row: { gap: theme.spacing.sm, paddingVertical: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: theme.spacing.md, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, borderWidth: 1, borderColor: theme.color.border },
  chipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  chipText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  desc: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.sm },
});

import React from "react";
import { View, Text, TextInput, StyleSheet, TextInputProps } from "react-native";

import { theme } from "@/src/theme";

type Props = TextInputProps & { label: string; testID?: string; hint?: string };

export default function Field({ label, hint, style, ...rest }: Props) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={theme.color.onSurfaceTertiary}
        style={[styles.input, rest.multiline && styles.multiline, style]}
        {...rest}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: theme.spacing.lg },
  label: { fontSize: 13, fontWeight: "600", color: theme.color.onSurfaceSecondary, marginBottom: theme.spacing.sm },
  input: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 52, fontSize: 16, color: theme.color.onSurface },
  multiline: { height: 88, paddingTop: theme.spacing.md, textAlignVertical: "top" },
  hint: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 6 },
});

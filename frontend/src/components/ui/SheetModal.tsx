import React from "react";
import { Modal, View, Text, StyleSheet, Pressable, KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { FRAME_WIDTH } from "@/src/hooks/useResponsive";

type Props = {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testID?: string;
};

/** Full-screen sheet-style modal used for forms (private ride, add member, member detail). */
export default function SheetModal({ visible, title, subtitle, onClose, children, footer, testID }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root} testID={testID}>
        {/* Tablet / desktop: the sheet content is a centred column (FRAME_WIDTH) instead of stretching edge to edge */}
        <View style={styles.column}>
        <View style={[styles.header, { paddingTop: Platform.OS === "ios" ? theme.spacing.lg : insets.top + theme.spacing.md }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          <Pressable testID="sheet-close" onPress={onClose} hitSlop={10} style={styles.close}>
            <Icon name="close" size={22} color={theme.color.onSurface} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={[styles.footer, { paddingBottom: insets.bottom + theme.spacing.md }]}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  column: { flex: 1, width: "100%", maxWidth: FRAME_WIDTH, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: theme.spacing.xl, paddingBottom: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  title: { fontSize: 22, fontWeight: "800", color: theme.color.onSurface, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  close: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  body: { padding: theme.spacing.xl, paddingBottom: theme.spacing.xxl },
  footer: { paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, borderTopWidth: 1, borderTopColor: theme.color.divider, backgroundColor: theme.color.surface },
});

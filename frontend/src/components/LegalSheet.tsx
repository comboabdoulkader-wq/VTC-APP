import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";

import { theme } from "@/src/theme";
import { apiFetch } from "@/src/context/auth";
import SheetModal from "@/src/components/ui/SheetModal";
import { useI18n } from "@/src/i18n";

type Page = { title: string; sections: { heading: string; text: string }[] };
type Legal = { company_name: string; email: string; updated_at: string; pages: Record<"terms" | "privacy" | "cancellation", Page> };
const TABS = ["terms", "privacy", "cancellation"] as const;

/** Legal pages: Terms of Service, Privacy Policy, Cancellation Policy (fr/en, other languages fall back to en). */
export default function LegalSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<Legal | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("terms");

  useEffect(() => { if (visible) apiFetch<Legal>(`/legal?lang=${lang}`).then(setData).catch(() => {}); }, [visible, lang]);

  const page = data?.pages[tab];
  return (
    <SheetModal visible={visible} onClose={onClose} title={t("legal")} subtitle={data ? `${data.company_name} · ${data.updated_at}` : undefined} testID="legal-sheet">
      <View style={styles.tabs}>
        {TABS.map((k) => (
          <Pressable key={k} testID={`legal-tab-${k}`} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabActive]}>
            <Text style={[styles.tabText, tab === k && { color: theme.color.onBrand }]}>{t(k === "terms" ? "legal_terms" : k === "privacy" ? "legal_privacy" : "legal_cancellation")}</Text>
          </Pressable>
        ))}
      </View>
      {!page ? <ActivityIndicator color={theme.color.onSurface} /> : (
        <View testID={`legal-page-${tab}`}>
          <Text style={styles.title}>{page.title}</Text>
          {page.sections.map((s, i) => (
            <View key={i} style={styles.section}>
              <Text style={styles.heading}>{s.heading}</Text>
              <Text style={styles.text}>{s.text}</Text>
            </View>
          ))}
        </View>
      )}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: "row", backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, padding: 4, marginBottom: theme.spacing.lg },
  tab: { flex: 1, height: 40, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  tabActive: { backgroundColor: theme.color.brand },
  tabText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  title: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface, marginBottom: theme.spacing.md },
  section: { marginBottom: theme.spacing.lg },
  heading: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface, marginBottom: 4 },
  text: { fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 19 },
});

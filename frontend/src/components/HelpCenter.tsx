import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Linking, ActivityIndicator } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch } from "@/src/context/auth";
import SheetModal from "@/src/components/ui/SheetModal";
import { useI18n } from "@/src/i18n";

type Config = { company_name: string; whatsapp: string; email: string; phone: string; hours: string; faq: { q: string; a: string }[] };

/** Help center: FAQ (per language) + WhatsApp / email / phone contact. Contact details come from backend env (SUPPORT_*). */
export default function HelpCenter({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [open, setOpen] = useState<number | null>(0);

  useEffect(() => {
    if (!visible) return;
    apiFetch<Config>(`/support/config?lang=${lang}`).then(setCfg).catch(() => {});
  }, [visible, lang]);

  const wa = cfg?.whatsapp?.replace(/\D/g, "");
  const hasContact = !!(wa || cfg?.email || cfg?.phone);

  return (
    <SheetModal visible={visible} onClose={onClose} title={t("help")} subtitle={cfg ? `${cfg.company_name} · ${cfg.hours}` : undefined} testID="help-center">
      {!cfg ? <ActivityIndicator color={theme.color.onSurface} /> : (
        <>
          <Text style={styles.section}>{t("contact_us")}</Text>
          {hasContact ? (
            <View style={styles.contacts}>
              {wa ? <Contact testID="contact-whatsapp" icon="whatsapp" label="WhatsApp" value={cfg.whatsapp} color="#25D366" onPress={() => Linking.openURL(`https://wa.me/${wa}`)} /> : null}
              {cfg.email ? <Contact testID="contact-email" icon="email-outline" label="Email" value={cfg.email} color={theme.color.onSurface} onPress={() => Linking.openURL(`mailto:${cfg.email}`)} /> : null}
              {cfg.phone ? <Contact testID="contact-phone" icon="phone-outline" label={t("tab_profile") === "Profil" ? "Téléphone" : "Phone"} value={cfg.phone} color={theme.color.onSurface} onPress={() => Linking.openURL(`tel:${cfg.phone.replace(/\s/g, "")}`)} /> : null}
            </View>
          ) : (
            <Text style={styles.empty} testID="support-empty">{t("support_unavailable")}</Text>
          )}

          <Text style={styles.section}>{t("faq")}</Text>
          {cfg.faq.map((item, i) => (
            <Pressable key={i} testID={`faq-${i}`} onPress={() => setOpen(open === i ? null : i)} style={styles.faqItem}>
              <View style={styles.faqHead}>
                <Text style={styles.faqQ}>{item.q}</Text>
                <Icon name={open === i ? "chevron-up" : "chevron-down"} size={20} color={theme.color.onSurfaceTertiary} />
              </View>
              {open === i ? <Text style={styles.faqA}>{item.a}</Text> : null}
            </Pressable>
          ))}
        </>
      )}
    </SheetModal>
  );
}

function Contact({ icon, label, value, color, onPress, testID }: { icon: string; label: string; value: string; color: string; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={styles.contact}>
      <Icon name={icon as any} size={24} color={color} />
      <View style={{ flex: 1 }}><Text style={styles.contactLabel}>{label}</Text><Text style={styles.contactValue}>{value}</Text></View>
      <Icon name="open-in-new" size={18} color={theme.color.onSurfaceTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 13, fontWeight: "800", color: theme.color.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm },
  contacts: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, overflow: "hidden" },
  contact: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingHorizontal: theme.spacing.lg, minHeight: 60, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  contactLabel: { fontSize: 12, color: theme.color.onSurfaceTertiary },
  contactValue: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  empty: { fontSize: 13, color: theme.color.onSurfaceTertiary, backgroundColor: theme.color.surfaceSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.md },
  faqItem: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.sm },
  faqHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  faqQ: { flex: 1, fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  faqA: { fontSize: 13, color: theme.color.onSurfaceSecondary, lineHeight: 19, marginTop: theme.spacing.sm },
});

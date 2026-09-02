import { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, RefreshControl, Alert, TextInput, Image } from "react-native";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import SheetModal from "@/src/components/ui/SheetModal";
import { pickImage, uploadDocument } from "@/src/utils/files";

type Item = { key: string; label: string; category: "driver" | "vehicle"; required: boolean; expires: boolean; state: string; doc: any };
type Compliance = { blocked: boolean; block_message?: string | null; blocking: string[]; expiring: { label: string; valid_until: string }[]; items: Item[]; selfie_requested: boolean; selfie: any };

export const STATE: Record<string, { label: string; color: string; icon: string }> = {
  missing: { label: "Manquant", color: theme.color.error, icon: "alert-circle-outline" },
  expired: { label: "Expiré", color: theme.color.error, icon: "close-circle-outline" },
  rejected: { label: "Refusé", color: theme.color.error, icon: "close-circle-outline" },
  expiring: { label: "Expire bientôt", color: theme.color.warning, icon: "clock-alert-outline" },
  pending: { label: "En vérification", color: theme.color.warning, icon: "progress-clock" },
  valid: { label: "Valide", color: theme.color.success, icon: "check-circle-outline" },
  not_applicable: { label: "Non concerné", color: theme.color.onSurfaceTertiary, icon: "minus-circle-outline" },
};

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");
const parseFr = (s: string): string | null => {
  const m = s.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12));
  return isNaN(d.getTime()) ? null : d.toISOString();
};

export default function Documents() {
  const insets = useSafeAreaInsets();
  const { token, refresh } = useAuth();
  const [data, setData] = useState<Compliance | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [asset, setAsset] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, h] = await Promise.all([apiFetch<Compliance>("/documents/mine", {}, token), apiFetch<any[]>("/documents/history", {}, token)]);
      setData(c); setHistory(h);
    } catch {} finally { setRefreshing(false); }
  }, [token]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openEditor = (it: Item) => { setEditing(it); setFrom(""); setUntil(""); setAsset(null); };

  const pick = async (src: "camera" | "library") => { const a = await pickImage(src); if (a) setAsset(a); };

  const save = async () => {
    if (!editing || !asset) { Alert.alert("Photo requise", "Prenez une photo ou choisissez un fichier."); return; }
    const vu = editing.expires ? parseFr(until) : null;
    if (editing.expires && !vu) { Alert.alert("Date invalide", "Date d'expiration au format JJ/MM/AAAA"); return; }
    const vf = from ? parseFr(from) : null;
    setSaving(true);
    try {
      const fields: Record<string, string> = { type: editing.key };
      if (vf) fields.valid_from = vf;
      if (vu) fields.valid_until = vu;
      setData(await uploadDocument(token, asset, fields));
      setEditing(null);
      refresh();
    } catch (e: any) { Alert.alert("Téléversement impossible", e.message); } finally { setSaving(false); }
  };

  const markNA = async (it: Item) => {
    try { setData(await apiFetch<Compliance>(`/documents/${it.key}/not-applicable`, { method: "POST" }, token)); refresh(); } catch (e: any) { Alert.alert("Erreur", e.message); }
  };

  const sendSelfie = async () => {
    const a = await pickImage("camera") || (await pickImage("library"));
    if (!a) return;
    setSaving(true);
    try { setData(await uploadDocument(token, a, { type: "selfie" })); Alert.alert("Selfie envoyé", "Le gérant va vérifier votre identité."); }
    catch (e: any) { Alert.alert("Erreur", e.message); } finally { setSaving(false); }
  };

  const section = (cat: "driver" | "vehicle", title: string) => (
    <>
      <Text style={styles.section}>{title}</Text>
      {data!.items.filter((i) => i.category === cat).map((it) => {
        const st = STATE[it.state];
        return (
          <View key={it.key} style={styles.card} testID={`doc-${it.key}`}>
            <Icon name={st.icon as any} size={24} color={st.color} />
            <View style={{ flex: 1 }}>
              <Text style={styles.docLabel}>{it.label}{!it.required && it.state === "missing" ? " (si applicable)" : ""}</Text>
              <Text style={[styles.docState, { color: st.color }]}>{st.label}{it.doc?.valid_until && it.state !== "not_applicable" ? ` · jusqu'au ${fmt(it.doc.valid_until)}` : ""}{it.doc?.review_note ? ` · ${it.doc.review_note}` : ""}</Text>
            </View>
            <View style={{ gap: 6, alignItems: "flex-end" }}>
              <Pressable testID={`doc-upload-${it.key}`} onPress={() => openEditor(it)} style={styles.smallBtn}><Text style={styles.smallBtnText}>{it.doc && !it.doc.not_applicable ? "Remplacer" : "Ajouter"}</Text></Pressable>
              {!it.required && it.state === "missing" && <Pressable testID={`doc-na-${it.key}`} onPress={() => markNA(it)}><Text style={styles.naText}>Non concerné</Text></Pressable>}
            </View>
          </View>
        );
      })}
    </>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="documents-screen">
      <View style={styles.header}><Text style={styles.title}>Mes documents</Text><Text style={styles.subtitle}>Conformité chauffeur et véhicule</Text></View>
      {!data ? <ActivityIndicator style={{ marginTop: 40 }} color={theme.color.onSurface} /> : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: theme.spacing.xl, paddingBottom: insets.bottom + 40 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
          {data.blocked ? (
            <View style={[styles.banner, { backgroundColor: "#FDECEC", borderColor: "#F5B5B5" }]} testID="blocked-banner">
              <Icon name="lock-alert" size={22} color={theme.color.error} />
              <View style={{ flex: 1 }}><Text style={[styles.bannerTitle, { color: theme.color.error }]}>Compte bloqué</Text><Text style={styles.bannerText}>{data.block_message}</Text><Text style={styles.bannerText}>À fournir : {data.blocking.join(", ")}</Text></View>
            </View>
          ) : (
            <View style={[styles.banner, { backgroundColor: "#EAF6EE", borderColor: "#BFE3CC" }]} testID="compliant-banner">
              <Icon name="shield-check" size={22} color={theme.color.success} />
              <View style={{ flex: 1 }}><Text style={[styles.bannerTitle, { color: theme.color.success }]}>Compte actif</Text><Text style={styles.bannerText}>Tous vos documents obligatoires sont valides.</Text></View>
            </View>
          )}
          {data.expiring.map((e) => (
            <View key={e.label} style={[styles.banner, { backgroundColor: "#FFF7ED", borderColor: "#FED7AA" }]} testID="expiring-banner">
              <Icon name="clock-alert-outline" size={20} color={theme.color.warning} />
              <Text style={[styles.bannerText, { flex: 1 }]}><Text style={{ fontWeight: "800" }}>{e.label}</Text> expire le {fmt(e.valid_until)} (moins de 30 jours). Renouvelez-le pour éviter le blocage.</Text>
            </View>
          ))}
          {(data.selfie_requested || data.selfie?.status === "pending") && (
            <View style={[styles.banner, { backgroundColor: theme.color.surfaceSecondary, borderColor: theme.color.border }]} testID="selfie-banner">
              <Icon name="face-recognition" size={22} color={theme.color.onSurface} />
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>{data.selfie_requested ? "Vérification d'identité demandée" : "Selfie en cours de vérification"}</Text>
                <Text style={styles.bannerText}>{data.selfie_requested ? "Le gérant de l'application vous demande un selfie pour confirmer votre identité." : "Le gérant vérifie votre selfie."}</Text>
                {data.selfie_requested && <Pressable testID="send-selfie" onPress={sendSelfie} disabled={saving} style={[styles.smallBtn, { alignSelf: "flex-start", marginTop: 6 }]}>{saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.smallBtnText}>Prendre un selfie</Text>}</Pressable>}
              </View>
            </View>
          )}
          {section("driver", "Documents du chauffeur")}
          {section("vehicle", "Documents du véhicule")}

          <Pressable testID="toggle-history" onPress={() => setShowHistory((v) => !v)} style={[styles.card, { marginTop: theme.spacing.lg }]}>
            <Icon name="history" size={24} color={theme.color.onSurface} />
            <View style={{ flex: 1 }}>
              <Text style={styles.docLabel}>Historique des documents</Text>
              <Text style={styles.docState}>{history.length} version{history.length > 1 ? "s" : ""} archivée{history.length > 1 ? "s" : ""} · preuve de conformité passée</Text>
            </View>
            <Icon name={showHistory ? "chevron-up" : "chevron-down"} size={22} color={theme.color.onSurfaceTertiary} />
          </Pressable>
          {showHistory && (history.length === 0 ? <Text style={styles.hint}>Aucune ancienne version pour le moment.</Text> : history.map((h) => (
            <View key={h.id} style={styles.histRow} testID={`history-${h.id}`}>
              <Icon name="file-clock-outline" size={18} color={theme.color.onSurfaceTertiary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.histLabel}>{h.label}{h.not_applicable ? " · non concerné" : ""}</Text>
                <Text style={styles.histMeta}>
                  {h.valid_until ? `Valide jusqu'au ${fmt(h.valid_until)} · ` : ""}déposé le {fmt(h.uploaded_at)} · archivé le {fmt(h.archived_at)}{h.status === "rejected" ? " · refusé" : ""}
                </Text>
              </View>
            </View>
          )))}
        </ScrollView>
      )}

      <SheetModal visible={!!editing} onClose={() => setEditing(null)} title={editing?.label || ""} subtitle="Photo nette et lisible · JPG/PNG" testID="doc-editor"
        footer={<Pressable testID="doc-save" onPress={save} disabled={saving} style={[styles.primary, saving && { opacity: 0.6 }]}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Téléverser</Text>}</Pressable>}>
        <View style={styles.pickRow}>
          <Pressable testID="pick-camera" onPress={() => pick("camera")} style={styles.pickBtn}><Icon name="camera" size={22} color={theme.color.onSurface} /><Text style={styles.pickText}>Photo</Text></Pressable>
          <Pressable testID="pick-library" onPress={() => pick("library")} style={styles.pickBtn}><Icon name="image-multiple-outline" size={22} color={theme.color.onSurface} /><Text style={styles.pickText}>Galerie</Text></Pressable>
        </View>
        {asset && <Image source={{ uri: asset.uri }} style={styles.preview} resizeMode="cover" testID="doc-preview" />}
        <Text style={styles.label}>Début de validité (optionnel)</Text>
        <TextInput testID="doc-valid-from" value={from} onChangeText={setFrom} placeholder="JJ/MM/AAAA" keyboardType="numbers-and-punctuation" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
        {editing?.expires && (
          <>
            <Text style={styles.label}>Date d'expiration *</Text>
            <TextInput testID="doc-valid-until" value={until} onChangeText={setUntil} placeholder="JJ/MM/AAAA" keyboardType="numbers-and-punctuation" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} />
            <Text style={styles.hint}>Vous serez alerté 30 jours avant l'expiration. Un document expiré bloque automatiquement le compte.</Text>
          </>
        )}
      </SheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  header: { paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.lg },
  title: { fontSize: 30, fontWeight: "800", color: theme.color.onSurface, letterSpacing: -1 },
  subtitle: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  banner: { flexDirection: "row", gap: theme.spacing.md, alignItems: "flex-start", borderRadius: theme.radius.md, padding: theme.spacing.md, borderWidth: 1, marginBottom: theme.spacing.md },
  bannerTitle: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  bannerText: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 2, lineHeight: 18 },
  section: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  card: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm },
  docLabel: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  docState: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  smallBtn: { backgroundColor: theme.color.brand, paddingHorizontal: theme.spacing.md, height: 34, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  smallBtnText: { color: "#fff", fontWeight: "800", fontSize: 12 },
  naText: { fontSize: 11, color: theme.color.onSurfaceTertiary, fontWeight: "700" },
  pickRow: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  pickBtn: { flex: 1, height: 64, borderRadius: theme.radius.md, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center", gap: 4 },
  pickText: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface },
  preview: { width: "100%", height: 180, borderRadius: theme.radius.md, marginBottom: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary },
  label: { fontSize: 13, fontWeight: "700", color: theme.color.onSurfaceSecondary, marginBottom: 6 },
  input: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 50, fontSize: 16, color: theme.color.onSurface, marginBottom: theme.spacing.md },
  hint: { fontSize: 12, color: theme.color.onSurfaceTertiary },
  histRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  histLabel: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  histMeta: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  primary: { backgroundColor: theme.color.brand, height: 54, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});

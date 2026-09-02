import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Image, Alert, Platform, Linking } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import SheetModal from "@/src/components/ui/SheetModal";
import { apiFetch, useAuth } from "@/src/context/auth";
import { fileUrl } from "@/src/utils/files";
import { STATE } from "@/app/(driver)/documents";

type DriverRow = { id: string; full_name: string; email: string; vehicle_model?: string; license_plate?: string; is_online: boolean; blocked: boolean; blocking: string[]; expiring: any[]; selfie_requested: boolean; selfie_status?: string | null; pending_docs: number };

/** Admin (moderator) console: driver compliance, document review, on-demand selfie verification. */
export default function DriversAdmin({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any>(null);

  const load = useCallback(async () => {
    try { setDrivers(await apiFetch<DriverRow[]>("/admin/drivers", {}, token)); } catch {} finally { setLoading(false); }
  }, [token]);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  const openDriver = async (id: string) => {
    try { setDetail(await apiFetch(`/admin/drivers/${id}/documents`, {}, token)); } catch (e: any) { Alert.alert("Erreur", e.message); }
  };

  const review = async (docId: string, status: "valid" | "rejected") => {
    const doIt = async (note?: string) => {
      try { const c = await apiFetch<any>(`/admin/documents/${docId}`, { method: "PATCH", body: JSON.stringify({ status, note }) }, token); setDetail((d: any) => ({ ...d, ...c })); load(); }
      catch (e: any) { Alert.alert("Erreur", e.message); }
    };
    if (status === "rejected") {
      if (Platform.OS === "ios") Alert.prompt("Motif du refus", "Ex. document illisible", (t) => doIt(t));
      else doIt("Document non conforme");
    } else doIt();
  };

  const requestSelfie = async (id: string) => {
    try { await apiFetch(`/admin/drivers/${id}/request-selfie`, { method: "POST" }, token); Alert.alert("Demande envoyée", "Le chauffeur est invité à prendre un selfie."); load(); openDriver(id); } catch (e: any) { Alert.alert("Erreur", e.message); }
  };

  const openFile = (path: string) => { const url = fileUrl(path, token); Linking.openURL(url); };

  const DocCard = ({ label, doc, state }: { label: string; doc: any; state: string }) => {
    const st = STATE[state] || STATE.valid;
    const isImg = doc?.content_type?.startsWith("image/");
    return (
      <View style={styles.doc} testID={`admin-doc-${doc?.id || label}`}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name={st.icon as any} size={20} color={st.color} />
          <Text style={styles.docLabel}>{label}</Text>
          <Text style={[styles.docState, { color: st.color }]}>{st.label}</Text>
        </View>
        {doc && !doc.not_applicable && (
          <>
            {doc.file_path && (isImg
              ? <Pressable onPress={() => openFile(doc.file_path)}><Image source={{ uri: fileUrl(doc.file_path, token) }} style={styles.thumb} resizeMode="cover" /></Pressable>
              : <Pressable onPress={() => openFile(doc.file_path)} style={styles.pdf}><Icon name="file-pdf-box" size={22} color={theme.color.error} /><Text style={styles.pdfText}>{doc.filename || "Ouvrir le fichier"}</Text></Pressable>)}
            <Text style={styles.meta}>Validité : {doc.valid_from ? new Date(doc.valid_from).toLocaleDateString("fr-FR") : "—"} → {doc.valid_until ? new Date(doc.valid_until).toLocaleDateString("fr-FR") : "sans expiration"} · reçu le {new Date(doc.uploaded_at).toLocaleDateString("fr-FR")}</Text>
            <View style={styles.actions}>
              <Pressable testID={`validate-${doc.id}`} onPress={() => review(doc.id, "valid")} style={[styles.actBtn, { backgroundColor: theme.color.success }]}><Text style={styles.actText}>Valider</Text></Pressable>
              <Pressable testID={`reject-${doc.id}`} onPress={() => review(doc.id, "rejected")} style={[styles.actBtn, { backgroundColor: theme.color.error }]}><Text style={styles.actText}>Refuser</Text></Pressable>
            </View>
          </>
        )}
      </View>
    );
  };

  return (
    <>
      <SheetModal visible={visible && !detail} onClose={onClose} title="Chauffeurs & documents" subtitle="Conformité, blocages et vérifications d'identité" testID="drivers-admin">
        {loading ? <ActivityIndicator color={theme.color.onSurface} /> : drivers.map((d) => (
          <Pressable key={d.id} testID={`admin-driver-${d.id}`} onPress={() => openDriver(d.id)} style={styles.row}>
            <View style={[styles.dot, { backgroundColor: d.blocked ? theme.color.error : d.expiring.length || d.pending_docs ? theme.color.warning : theme.color.success }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{d.full_name}</Text>
              <Text style={styles.meta}>{d.blocked ? `Bloqué · ${d.blocking.join(", ")}` : d.expiring.length ? `${d.expiring.length} document(s) expire(nt) bientôt` : "Conforme"}{d.selfie_status === "pending" ? " · selfie à vérifier" : d.selfie_requested ? " · selfie demandé" : ""}</Text>
            </View>
            <Icon name="chevron-right" size={22} color={theme.color.onSurfaceTertiary} />
          </Pressable>
        ))}
      </SheetModal>

      <SheetModal visible={!!detail} onClose={() => setDetail(null)} title={detail?.driver?.full_name || ""} subtitle={detail ? `${detail.driver.email} · ${detail.driver.vehicle_model || ""} ${detail.driver.license_plate || ""}` : ""} testID="admin-driver-detail">
        {detail && (
          <>
            <View style={[styles.status, { backgroundColor: detail.blocked ? "#FDECEC" : "#EAF6EE" }]}>
              <Icon name={detail.blocked ? "lock-alert" : "shield-check"} size={20} color={detail.blocked ? theme.color.error : theme.color.success} />
              <Text style={[styles.statusText, { color: detail.blocked ? theme.color.error : theme.color.success }]}>{detail.blocked ? `Bloqué : ${detail.blocking.join(", ")}` : "Actif · documents conformes"}</Text>
            </View>
            <Pressable testID="request-selfie" onPress={() => requestSelfie(detail.driver.id)} style={styles.selfieBtn}><Icon name="face-recognition" size={18} color="#fff" /><Text style={styles.actText}>Demander un selfie de vérification</Text></Pressable>
            {detail.selfie && <DocCard label="Selfie de vérification" doc={detail.selfie} state={detail.selfie.status === "pending" ? "pending" : detail.selfie.status === "rejected" ? "rejected" : "valid"} />}
            <Text style={styles.section}>Chauffeur</Text>
            {detail.items.filter((i: any) => i.category === "driver").map((i: any) => <DocCard key={i.key} label={i.label} doc={i.doc} state={i.state} />)}
            <Text style={styles.section}>Véhicule</Text>
            {detail.items.filter((i: any) => i.category === "vehicle").map((i: any) => <DocCard key={i.key} label={i.label} doc={i.doc} state={i.state} />)}
          </>
        )}
      </SheetModal>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  dot: { width: 12, height: 12, borderRadius: 6 },
  name: { fontSize: 15, fontWeight: "700", color: theme.color.onSurface },
  meta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  status: { flexDirection: "row", alignItems: "center", gap: 8, padding: theme.spacing.md, borderRadius: theme.radius.md, marginBottom: theme.spacing.md },
  statusText: { flex: 1, fontSize: 13, fontWeight: "700" },
  selfieBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.brand, height: 46, borderRadius: theme.radius.pill, marginBottom: theme.spacing.md },
  section: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
  doc: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm, gap: 6 },
  docLabel: { flex: 1, fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  docState: { fontSize: 12, fontWeight: "700" },
  thumb: { width: "100%", height: 160, borderRadius: theme.radius.sm, backgroundColor: theme.color.surface },
  pdf: { flexDirection: "row", alignItems: "center", gap: 8, padding: theme.spacing.sm, backgroundColor: theme.color.surface, borderRadius: theme.radius.sm },
  pdfText: { fontSize: 13, color: theme.color.onSurface, fontWeight: "600" },
  actions: { flexDirection: "row", gap: theme.spacing.sm },
  actBtn: { flex: 1, height: 40, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  actText: { color: "#fff", fontWeight: "800", fontSize: 13 },
});

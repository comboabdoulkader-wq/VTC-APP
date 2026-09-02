import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Linking, Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import { money } from "@/src/utils/format";

const API = process.env.EXPO_PUBLIC_BACKEND_URL;
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

type Group = { id: string; label: string; count: number; gross: number; commission: number; net: number };
type Report = { month: string; label: string; count: number; gross?: number; total?: number; commission?: number; net?: number; groups: Group[] };

type Props = { basePath: "/team" | "/company"; groupLabel: string; showCommission?: boolean };

/** Monthly accounting: grouped statement + CSV/PDF export. Shared by team managers and companies. */
export default function AccountingExport({ basePath, groupLabel, showCommission = true }: Props) {
  const { token } = useAuth();
  const months = useMemo(() => Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }), []);
  const [month, setMonth] = useState(months[0]);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch<Report>(`${basePath}/${basePath === "/team" ? "invoices" : "report"}?month=${month}`, {}, token)
      .then((r) => alive && setReport(r)).catch(() => alive && setReport(null)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [month, basePath, token]);

  const download = async (fmt: "csv" | "pdf") => {
    const url = `${API}/api${basePath}/export.${fmt}?month=${month}&token=${token}`;
    if (Platform.OS === "web") Linking.openURL(url);
    else await WebBrowser.openBrowserAsync(url);
  };

  const label = (m: string) => { const [y, mm] = m.split("-"); return `${MONTHS[Number(mm) - 1]} ${y.slice(2)}`; };
  const total = report ? (report.gross ?? report.total ?? 0) : 0;

  return (
    <View style={styles.wrap} testID="accounting-export">
      <Text style={styles.title}><Icon name="file-document-multiple-outline" size={18} /> Comptabilité · regroupement mensuel</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm }}>
        {months.map((m) => (
          <Pressable key={m} testID={`month-${m}`} onPress={() => setMonth(m)} style={[styles.chip, month === m && styles.chipActive]}>
            <Text style={[styles.chipText, month === m && styles.chipTextActive]}>{label(m)}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? <ActivityIndicator style={{ marginVertical: 20 }} color={theme.color.onSurface} /> : report && (
        <View style={styles.box}>
          <View style={styles.rowBetween}>
            <Text style={styles.boxTitle}>{report.label}</Text>
            <Text style={styles.boxTotal}>{money(total)}</Text>
          </View>
          <Text style={styles.boxMeta}>{report.count} course{report.count > 1 ? "s" : ""} terminée{report.count > 1 ? "s" : ""}{showCommission && report.commission != null ? ` · commissions ${money(report.commission)} · net ${money(report.net)}` : ""}</Text>
          {report.groups.length === 0 ? <Text style={styles.empty}>Aucune course sur cette période</Text> : report.groups.map((g) => (
            <View key={g.id || g.label} style={styles.groupRow} testID={`invoice-group-${g.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.groupName}>{g.label}</Text>
                <Text style={styles.groupMeta}>{g.count} course{g.count > 1 ? "s" : ""}{showCommission && g.commission > 0 ? ` · commission ${money(g.commission)}` : ""}</Text>
              </View>
              <Text style={styles.groupAmount}>{money(g.gross)}</Text>
            </View>
          ))}
          <View style={styles.actions}>
            <Pressable testID="export-pdf" onPress={() => download("pdf")} style={styles.btn}><Icon name="file-pdf-box" size={18} color="#fff" /><Text style={styles.btnText}>Relevé PDF</Text></Pressable>
            <Pressable testID="export-csv" onPress={() => download("csv")} style={styles.btnOutline}><Icon name="file-delimited-outline" size={18} color={theme.color.onSurface} /><Text style={styles.btnOutlineText}>Export CSV</Text></Pressable>
          </View>
          <Text style={styles.hint}>Le relevé regroupe toutes les factures du mois par {groupLabel}, prêt pour votre comptable.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: theme.spacing.xl },
  title: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, marginBottom: theme.spacing.md },
  chip: { paddingHorizontal: theme.spacing.lg, height: 36, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  chipActive: { backgroundColor: theme.color.brand },
  chipText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  chipTextActive: { color: "#fff" },
  box: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, marginTop: theme.spacing.md },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  boxTitle: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, textTransform: "capitalize" },
  boxTotal: { fontSize: 20, fontWeight: "800", color: theme.color.onSurface },
  boxMeta: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2, marginBottom: theme.spacing.sm },
  empty: { fontSize: 13, color: theme.color.onSurfaceTertiary, paddingVertical: theme.spacing.md },
  groupRow: { flexDirection: "row", alignItems: "center", paddingVertical: theme.spacing.sm, borderTopWidth: 1, borderTopColor: theme.color.border },
  groupName: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  groupMeta: { fontSize: 12, color: theme.color.onSurfaceTertiary },
  groupAmount: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  actions: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
  btn: { flex: 1, flexDirection: "row", gap: 6, height: 46, borderRadius: theme.radius.pill, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  btnOutline: { flex: 1, flexDirection: "row", gap: 6, height: 46, borderRadius: theme.radius.pill, borderWidth: 1.5, borderColor: theme.color.borderStrong, alignItems: "center", justifyContent: "center" },
  btnOutlineText: { color: theme.color.onSurface, fontWeight: "800", fontSize: 14 },
  hint: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.sm },
});

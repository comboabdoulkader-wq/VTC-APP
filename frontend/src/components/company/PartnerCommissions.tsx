import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput, Alert, Linking, Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import { money, fmtDateTime } from "@/src/utils/format";
import SheetModal from "@/src/components/ui/SheetModal";

const API = process.env.EXPO_PUBLIC_BACKEND_URL;
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

type Line = { id: string; type: string; label: string; amount: number; created_at: string };
type Data = { month: string; label: string; rate: number; balance: number; earned: number; direct: number; network: number; count: number; lines: Line[]; payouts: Line[] };
type Ranking = { rank: number; total_partners: number; commissioned_partners: number; my_total: number; leaderboard: { position: number; is_me: boolean; name: string; total: number; count: number }[]; best_months: { month: string; label: string; total: number; count: number }[] };

const ORIGIN: Record<string, { label: string; icon: string }> = {
  partner_commission: { label: "Client direct", icon: "account-star-outline" },
  referral_l1: { label: "Filleul", icon: "account-multiple-outline" },
  referral_l2: { label: "Réseau N2", icon: "network-outline" },
};

const alertMsg = (title: string, msg?: string) => {
  if (Platform.OS === "web") window.alert(msg ? `${title}\n\n${msg}` : title);
  else Alert.alert(title, msg);
};

/** Monthly commission statement for a partner (hotel/concierge): earnings on their clients' rides, wallet + payout. */
export default function PartnerCommissions({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }), []);
  const [idx, setIdx] = useState(0);
  const month = months[idx];
  const [data, setData] = useState<Data | null>(null);
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [loading, setLoading] = useState(false);
  const [payout, setPayout] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await apiFetch<Data>(`/company/commissions?month=${month}`, {}, token)); }
    catch { setData(null); } finally { setLoading(false); }
  }, [month, token]);
  useEffect(() => { if (visible) load(); }, [visible, load]);
  useEffect(() => { if (visible) apiFetch<Ranking>("/company/ranking", {}, token).then(setRanking).catch(() => setRanking(null)); }, [visible, token]);

  const label = (m: string) => { const [y, mm] = m.split("-"); return `${MONTHS[Number(mm) - 1]} ${y.slice(2)}`; };

  const downloadPdf = async () => {
    const url = `${API}/api/company/commissions/export.pdf?month=${month}&token=${token}`;
    if (Platform.OS === "web") Linking.openURL(url); else await WebBrowser.openBrowserAsync(url);
  };

  const requestPayout = async () => {
    const amount = parseFloat(payout.replace(",", "."));
    if (!amount || amount <= 0) { alertMsg("Montant invalide", "Saisissez un montant supérieur à 0."); return; }
    setBusy(true);
    try {
      const r = await apiFetch<any>("/company/wallet/payout", { method: "POST", body: JSON.stringify({ amount }) }, token);
      setPayout("");
      alertMsg("Demande envoyée", `Versement de ${money(r.amount)} demandé. Solde restant : ${money(r.balance)}.`);
      load();
    } catch (e: any) { alertMsg("Impossible", e.message); } finally { setBusy(false); }
  };

  return (
    <SheetModal visible={visible} onClose={onClose} title="Relevé de commissions" subtitle="Vos gains sur les courses de vos clients" testID="partner-commissions">
      <View style={styles.monthNav}>
        <Pressable testID="comm-prev" onPress={() => setIdx((i) => Math.min(months.length - 1, i + 1))} style={styles.navBtn} hitSlop={8}><Icon name="chevron-left" size={22} color={theme.color.onSurface} /></Pressable>
        <Text style={styles.monthLabel}>{label(month)}</Text>
        <Pressable testID="comm-next" onPress={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} style={[styles.navBtn, idx === 0 && { opacity: 0.3 }]} hitSlop={8}><Icon name="chevron-right" size={22} color={theme.color.onSurface} /></Pressable>
      </View>

      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Solde du portefeuille</Text>
        <Text style={styles.heroValue} testID="comm-balance">{money(data?.balance)}</Text>
        <Text style={styles.heroHint}>Vous gagnez {Math.round((data?.rate ?? 0.05) * 100)} % sur chaque course de vos clients, crédités ici automatiquement.</Text>
      </View>

      {ranking && ranking.my_total > 0 && (
        <View style={styles.rankCard} testID="comm-ranking">
          <View style={styles.rankRow}>
            <Icon name="trophy-variant-outline" size={22} color="#E8B84B" />
            <Text style={styles.rankTitle}>Classement partenaires</Text>
          </View>
          <Text style={styles.rankBig}>#{ranking.rank}<Text style={styles.rankSmall}> / {ranking.commissioned_partners}</Text></Text>
          <Text style={styles.rankHint}>{ranking.my_total.toFixed(2)} € de commissions cumulées{ranking.rank === 1 ? " · vous êtes en tête 🎉" : " · continuez à réserver pour grimper"}</Text>
          {ranking.best_months.length > 0 && (
            <View style={styles.bestRow}>
              {ranking.best_months.map((b) => (
                <View key={b.month} style={styles.bestPill}><Text style={styles.bestLabel}>{b.label}</Text><Text style={styles.bestVal}>{money(b.total)}</Text></View>
              ))}
            </View>
          )}
        </View>
      )}

      {loading ? <ActivityIndicator style={{ marginVertical: 24 }} color={theme.color.onSurface} /> : (
        <>
          <View style={styles.totals}>
            <Stat label="Commissions du mois" value={money(data?.earned)} big />
            <Stat label="Clients directs" value={money(data?.direct)} />
            <Stat label="Réseau (filleuls)" value={money(data?.network)} />
          </View>

          <View style={styles.payRow}>
            <TextInput testID="payout-input" value={payout} onChangeText={setPayout} keyboardType="decimal-pad" placeholder="Montant à verser (€)" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.payInput} />
            <Pressable testID="payout-btn" onPress={requestPayout} disabled={busy} style={[styles.payBtn, busy && { opacity: 0.5 }]}>{busy ? <ActivityIndicator color={theme.color.onBrand} /> : <Text style={styles.payBtnText}>Demander</Text>}</Pressable>
          </View>
          <Pressable testID="comm-pdf" onPress={downloadPdf} style={styles.pdf}><Icon name="file-pdf-box" size={18} color={theme.color.onSurface} /><Text style={styles.pdfText}>Télécharger le relevé PDF</Text></Pressable>
          <Text style={styles.autoNote}>📧 Votre relevé est aussi envoyé automatiquement par email chaque début de mois.</Text>

          <Text style={styles.section}>Détail ({data?.count ?? 0})</Text>
          {data && data.lines.length > 0 ? data.lines.map((l) => {
            const o = ORIGIN[l.type] || { label: l.type, icon: "cash" };
            return (
              <View key={l.id} style={styles.line} testID={`comm-line-${l.id}`}>
                <Icon name={o.icon} size={20} color={theme.color.onSurfaceSecondary} />
                <View style={{ flex: 1 }}><Text style={styles.lineLabel} numberOfLines={1}>{l.label}</Text><Text style={styles.lineMeta}>{o.label} · {fmtDateTime(l.created_at)}</Text></View>
                <Text style={styles.lineAmt}>+{money(l.amount)}</Text>
              </View>
            );
          }) : <Text style={styles.empty}>Aucune commission sur cette période.</Text>}

          {data && data.payouts.length > 0 && (
            <>
              <Text style={styles.section}>Versements</Text>
              {data.payouts.map((p) => (
                <View key={p.id} style={styles.line}>
                  <Icon name="bank-transfer-out" size={20} color={theme.color.onSurfaceSecondary} />
                  <View style={{ flex: 1 }}><Text style={styles.lineLabel}>Versement demandé</Text><Text style={styles.lineMeta}>{fmtDateTime(p.created_at)}</Text></View>
                  <Text style={[styles.lineAmt, { color: theme.color.error }]}>{money(p.amount)}</Text>
                </View>
              ))}
            </>
          )}
        </>
      )}
    </SheetModal>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, big && { fontSize: 22, color: theme.color.success }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  monthNav: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing.xl, marginBottom: theme.spacing.lg },
  navBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  monthLabel: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, minWidth: 110, textAlign: "center" },
  hero: { backgroundColor: "#1B2A41", borderRadius: theme.radius.lg, padding: theme.spacing.lg, marginBottom: theme.spacing.lg },
  heroLabel: { fontSize: 12, color: "rgba(255,255,255,0.7)" },
  heroValue: { fontSize: 34, fontWeight: "800", color: "#fff", letterSpacing: -1, marginTop: 2 },
  heroHint: { fontSize: 12, color: "rgba(255,255,255,0.75)", marginTop: 6, lineHeight: 17 },
  rankCard: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.lg, padding: theme.spacing.lg, marginBottom: theme.spacing.lg, borderWidth: 1, borderColor: "#E8B84B33" },
  rankRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  rankTitle: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  rankBig: { fontSize: 30, fontWeight: "800", color: theme.color.onSurface, marginTop: 4 }, rankSmall: { fontSize: 16, fontWeight: "700", color: theme.color.onSurfaceTertiary },
  rankHint: { fontSize: 12, color: theme.color.onSurfaceSecondary, marginTop: 2 },
  bestRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginTop: theme.spacing.md },
  bestPill: { backgroundColor: theme.color.surface, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, paddingVertical: 6 },
  bestLabel: { fontSize: 11, color: theme.color.onSurfaceTertiary }, bestVal: { fontSize: 14, fontWeight: "800", color: theme.color.success },
  autoNote: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginBottom: theme.spacing.lg, lineHeight: 16 },
  totals: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm, marginBottom: theme.spacing.lg },
  stat: { flexGrow: 1, flexBasis: 100, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md },
  statLabel: { fontSize: 11, color: theme.color.onSurfaceTertiary }, statValue: { fontSize: 16, fontWeight: "800", color: theme.color.onSurface, marginTop: 4 },
  payRow: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  payInput: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 48, fontSize: 15, color: theme.color.onSurface },
  payBtn: { backgroundColor: theme.color.brand, paddingHorizontal: theme.spacing.xl, height: 48, borderRadius: theme.radius.md, alignItems: "center", justifyContent: "center" },
  payBtnText: { color: theme.color.onBrand, fontWeight: "800" },
  pdf: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing.sm, height: 46, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.border, marginBottom: theme.spacing.lg },
  pdfText: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  section: { fontSize: 13, fontWeight: "800", color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.md, marginBottom: theme.spacing.sm },
  line: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.color.border },
  lineLabel: { fontSize: 14, fontWeight: "600", color: theme.color.onSurface }, lineMeta: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  lineAmt: { fontSize: 15, fontWeight: "800", color: theme.color.success },
  empty: { fontSize: 13, color: theme.color.onSurfaceTertiary, paddingVertical: theme.spacing.md },
});

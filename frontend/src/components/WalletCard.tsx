import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, Alert, Share, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";
import { money, fmtDateTime } from "@/src/utils/format";

type Wallet = { balance: number; referral_code: string; sponsor_name: string | null; referrals_count: number; earned_total: number; transactions: any[]; rates: { driver: number; other: number; level2: number } };

/** Rewards wallet + referral program block (all roles). Credits are usable on rides, never withdrawn as cash. */
export default function WalletCard() {
  const { token, user } = useAuth();
  const [w, setW] = useState<Wallet | null>(null);
  const [code, setCode] = useState("");
  const [showTx, setShowTx] = useState(false);

  const load = useCallback(async () => { try { setW(await apiFetch<Wallet>("/wallet", {}, token)); } catch {} }, [token]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const apply = async () => {
    try { const r = await apiFetch<any>("/wallet/apply-code", { method: "POST", body: JSON.stringify({ code }) }, token); Alert.alert("Parrain ajouté", `Vous êtes désormais parrainé par ${r.sponsor_name}`); setCode(""); load(); }
    catch (e: any) { Alert.alert("Code invalide", e.message); }
  };
  const share = async () => {
    const msg = `Rejoins-moi sur RideGo avec mon code ${w?.referral_code} : tes courses alimentent nos portefeuilles récompenses !`;
    try { if (Platform.OS === "web") { await (navigator as any).clipboard?.writeText(w?.referral_code || ""); Alert.alert("Code copié", w?.referral_code); } else await Share.share({ message: msg }); } catch {}
  };

  if (!w) return null;
  const myRate = user?.role === "driver" ? w.rates.driver : w.rates.other;
  return (
    <View style={styles.card} testID="wallet-card">
      <View style={styles.head}>
        <Icon name="wallet-giftcard" size={20} color="#fff" />
        <Text style={styles.title}>Portefeuille récompenses</Text>
      </View>
      <Text style={styles.balance} testID="wallet-balance">{money(w.balance)}</Text>
      <Text style={styles.meta}>Crédit utilisable pour vos courses · {money(w.earned_total)} gagnés au total · {w.referrals_count} filleul{w.referrals_count > 1 ? "s" : ""}</Text>
      <Pressable testID="share-referral" onPress={share} style={styles.codeBox}>
        <View style={{ flex: 1 }}><Text style={styles.codeLabel}>Mon code de parrainage</Text><Text style={styles.code}>{w.referral_code}</Text></View>
        <Icon name="share-variant-outline" size={20} color="#fff" />
      </Pressable>
      <Text style={styles.meta}>Vous gagnez {Math.round(myRate * 100)} % du prix des courses de vos filleuls et {Math.round(w.rates.level2 * 100)} % de leurs commissions (niveau 2), crédités automatiquement.</Text>
      {w.sponsor_name ? <Text style={styles.meta}>Parrainé par {w.sponsor_name}</Text> : (
        <View style={styles.row}>
          <TextInput testID="referral-input" value={code} onChangeText={(t) => setCode(t.toUpperCase())} placeholder="Code d'un parrain" autoCapitalize="characters" placeholderTextColor="rgba(255,255,255,0.6)" style={styles.input} maxLength={12} />
          <Pressable testID="referral-apply" onPress={apply} disabled={code.length < 4} style={[styles.btn, code.length < 4 && { opacity: 0.5 }]}><Text style={styles.btnText}>Valider</Text></Pressable>
        </View>
      )}
      <Pressable testID="wallet-toggle-tx" onPress={() => setShowTx((v) => !v)} style={{ marginTop: theme.spacing.sm }}><Text style={[styles.meta, { textDecorationLine: "underline" }]}>{showTx ? "Masquer" : "Voir"} l'historique ({w.transactions.length})</Text></Pressable>
      {showTx && w.transactions.map((t) => (
        <View key={t.id} style={styles.tx}>
          <View style={{ flex: 1 }}><Text style={styles.txLabel}>{t.label}</Text><Text style={styles.txMeta}>{fmtDateTime(t.created_at)}</Text></View>
          <Text style={[styles.txAmt, { color: t.amount >= 0 ? "#9EF0B8" : "#FFB4B4" }]}>{t.amount >= 0 ? "+" : ""}{money(t.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: "#1B2A41", borderRadius: theme.radius.lg, padding: theme.spacing.lg, marginBottom: theme.spacing.xl },
  head: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  title: { fontSize: 15, fontWeight: "800", color: "#fff" },
  balance: { fontSize: 34, fontWeight: "800", color: "#fff", letterSpacing: -1, marginTop: 4 },
  meta: { fontSize: 12, color: "rgba(255,255,255,0.75)", marginTop: 4, lineHeight: 17 },
  codeBox: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: theme.radius.md, padding: theme.spacing.md, marginTop: theme.spacing.md },
  codeLabel: { fontSize: 11, color: "rgba(255,255,255,0.7)" },
  code: { fontSize: 20, fontWeight: "800", color: "#fff", letterSpacing: 3 },
  row: { flexDirection: "row", gap: theme.spacing.sm, marginTop: theme.spacing.md },
  input: { flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 44, color: "#fff", fontWeight: "700", letterSpacing: 2 },
  btn: { backgroundColor: "#fff", paddingHorizontal: theme.spacing.lg, height: 44, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#1B2A41", fontWeight: "800" },
  tx: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.1)" },
  txLabel: { fontSize: 13, color: "#fff", fontWeight: "600" },
  txMeta: { fontSize: 11, color: "rgba(255,255,255,0.6)" },
  txAmt: { fontSize: 14, fontWeight: "800" },
});

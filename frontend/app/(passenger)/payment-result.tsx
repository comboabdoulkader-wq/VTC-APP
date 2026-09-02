import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";

// On web, closes the Stripe popup and hands control back to the opener tab.
WebBrowser.maybeCompleteAuthSession();

/** Landing page after Stripe Checkout (success or cancel). Verifies with backend then returns to the ride. */
export default function PaymentResult() {
  const { ride_id, cancelled } = useLocalSearchParams<{ ride_id?: string; cancelled?: string }>();
  const router = useRouter();
  const { token, loading } = useAuth();
  const [status, setStatus] = useState<"checking" | "paid" | "unpaid">("checking");

  useEffect(() => {
    if (loading || !ride_id) return;
    if (cancelled) { setStatus("unpaid"); return; }
    let tries = 0;
    const check = async () => {
      try {
        const r = await apiFetch<{ status: string }>(`/payments/status/${ride_id}`, {}, token);
        if (r.status === "paid") { setStatus("paid"); return; }
      } catch {}
      if (++tries < 5) setTimeout(check, 1500); else setStatus("unpaid");
    };
    check();
  }, [ride_id, cancelled, token, loading]);

  const goBack = () => router.replace(ride_id ? `/(passenger)/ride/${ride_id}` : "/(passenger)");

  return (
    <View style={styles.root} testID="payment-result">
      {status === "checking" ? (
        <>
          <ActivityIndicator size="large" color={theme.color.onSurface} />
          <Text style={styles.title}>Vérification du paiement…</Text>
        </>
      ) : (
        <>
          <Icon name={status === "paid" ? "check-decagram" : "credit-card-off-outline"} size={72} color={status === "paid" ? theme.color.success : theme.color.warning} />
          <Text style={styles.title}>{status === "paid" ? "Paiement confirmé" : "Paiement non finalisé"}</Text>
          <Text style={styles.sub}>{status === "paid" ? "Votre course est réglée par carte. Bon voyage !" : "Vous pourrez réessayer depuis le détail de la course."}</Text>
          <Pressable testID="payment-back" onPress={goBack} style={styles.btn}><Text style={styles.btnText}>Retour à la course</Text></Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.spacing.xxl, gap: theme.spacing.md, backgroundColor: theme.color.surface },
  title: { fontSize: 22, fontWeight: "800", color: theme.color.onSurface, textAlign: "center" },
  sub: { fontSize: 15, color: theme.color.onSurfaceSecondary, textAlign: "center" },
  btn: { marginTop: theme.spacing.lg, backgroundColor: theme.color.brand, height: 52, paddingHorizontal: theme.spacing.xxl, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});

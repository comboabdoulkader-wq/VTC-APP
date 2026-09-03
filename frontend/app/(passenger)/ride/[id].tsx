import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, ScrollView, Alert, Image, Share, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import RideSummary from "@/src/components/RideSummary";
import ReviewForm, { ReviewPayload } from "@/src/components/passenger/ReviewForm";
import MapCanvas, { MapMarker } from "@/src/components/MapCanvas";
import { apiFetch, useAuth } from "@/src/context/auth";
import { money, fmtDateTime } from "@/src/utils/format";
import RideChat, { ChatButton } from "@/src/components/RideChat";

WebBrowser.maybeCompleteAuthSession();

type Ride = any;


export default function RideDetail() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [submittingRate, setSubmittingRate] = useState(false);
  const [paying, setPaying] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<Ride>(`/rides/${id}`, {}, token);
      setRide(r);
    } catch {} finally { setLoading(false); }
  }, [id, token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!ride || ["completed", "cancelled"].includes(ride.status)) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [ride?.status, load]);

  const doCancel = async () => {
    try { await apiFetch(`/rides/${id}/cancel`, { method: "POST" }, token); router.replace("/(passenger)/rides"); } catch (e: any) { Alert.alert("Annulation", e.message); }
  };
  const cancel = () => {
    if (ride?.status === "accepted") {
      Alert.alert("Frais d'annulation", `Un chauffeur a déjà accepté votre course. Des frais d'annulation de 3,00 € seront appliqués${ride.payment_method === "card" ? " (prélevés par carte)" : " (à régler au chauffeur)"}. Confirmer ?`,
        [{ text: "Garder ma course", style: "cancel" }, { text: "Annuler quand même (3 €)", style: "destructive", onPress: doCancel }]);
    } else doCancel();
  };
  const shareTrip = async () => {
    const url = `${process.env.EXPO_PUBLIC_BACKEND_URL}/track/${ride?.share_token}`;
    const message = `Suivez mon trajet en direct : ${url}`;
    try {
      if (Platform.OS === "web" && (navigator as any).share) await (navigator as any).share({ title: "Suivi de mon trajet", text: message, url });
      else if (Platform.OS === "web") { await (navigator as any).clipboard?.writeText(url); Alert.alert("Lien copié", url); }
      else await Share.share({ message, url });
    } catch {}
  };

  const [receiptMsg, setReceiptMsg] = useState<string | null>(null);
  const emailReceipt = async () => {
    try {
      const r = await apiFetch<{ ok: boolean; email: string }>(`/rides/${id}/send-receipt`, { method: "POST" }, token);
      setReceiptMsg(r.ok ? t("receipt_sent", { email: r.email }) : t("receipt_failed"));
    } catch { setReceiptMsg(t("receipt_failed")); }
  };

  const submitRating = async (p: ReviewPayload) => {
    setSubmittingRate(true);
    try {
      await apiFetch(`/rides/${id}/rate`, { method: "POST", body: JSON.stringify(p) }, token);
      if (p.tip > 0 && ride?.payment_method === "card") {
        await checkout("tip");
      }
      await load();
    } catch {} finally { setSubmittingRate(false); }
  };

  const checkout = async (kind: "ride" | "tip") => {
    const returnUrl = Linking.createURL("payment-result");
    const { checkout_url } = await apiFetch<{ checkout_url: string }>(`/payments/checkout/${id}`, {
      method: "POST", body: JSON.stringify({ return_url: returnUrl, kind }),
    }, token);
    await WebBrowser.openAuthSessionAsync(checkout_url, returnUrl);
    const st = await apiFetch<{ status: string }>(`/payments/status/${id}?kind=${kind}`, {}, token);
    if (st.status === "paid") Alert.alert("Paiement confirmé", kind === "tip" ? "Merci pour votre pourboire !" : "Votre course est réglée par carte.");
  };

  const payByCard = async () => {
    setPaying(true);
    try { await checkout("ride"); load(); }
    catch (e: any) { Alert.alert("Paiement", e.message || "Impossible d'ouvrir le paiement"); } finally { setPaying(false); }
  };

  if (loading || !ride) {
    return <View style={styles.center}><ActivityIndicator color={theme.color.onSurface} /></View>;
  }

  const markers: MapMarker[] = [
    { id: "p", type: "pickup", coordinate: { latitude: ride.pickup.lat, longitude: ride.pickup.lng } },
    { id: "d", type: "dropoff", coordinate: { latitude: ride.dropoff.lat, longitude: ride.dropoff.lng } },
  ];
  if (ride.driver_location && ["accepted", "in_progress"].includes(ride.status)) {
    markers.push({ id: "drv", type: "driver", coordinate: { latitude: ride.driver_location.lat, longitude: ride.driver_location.lng } });
  }
  const canCancel = ["requested", "accepted"].includes(ride.status);
  const arriving = ride.status === "accepted" && ride.driver_eta_min != null && ride.driver_eta_min <= 2;
  const showPay = ride.payment_method === "card" && ride.payment_status !== "paid" && ride.status !== "cancelled";

  return (
    <View style={styles.root} testID="ride-detail">
      <MapCanvas
        region={{ latitude: (ride.pickup.lat + ride.dropoff.lat) / 2, longitude: (ride.pickup.lng + ride.dropoff.lng) / 2, latitudeDelta: 0.15, longitudeDelta: 0.15 }}
        markers={markers}
        polyline={[{ latitude: ride.pickup.lat, longitude: ride.pickup.lng }, { latitude: ride.dropoff.lat, longitude: ride.dropoff.lng }]}
      />

      <Pressable testID="ride-back-button" onPress={() => router.replace("/(passenger)/rides")} style={[styles.back, { top: insets.top + theme.spacing.md }]} hitSlop={12}>
        <Icon name="chevron-left" size={26} color={theme.color.onSurface} />
      </Pressable>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
        <View style={styles.handle} />
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.statusRow}>
            <Text style={styles.status}>{t(`sd_${ride.status}` as any)}</Text>
            {ride.driver_eta_min != null && ["accepted", "in_progress"].includes(ride.status) && (
              <View style={[styles.etaPill, arriving && { backgroundColor: theme.color.success }]} testID="driver-eta">
                <Icon name="clock-fast" size={14} color={arriving ? "#fff" : theme.color.onSurface} />
                <Text style={[styles.etaText, arriving && { color: "#fff" }]}>{ride.driver_eta_min <= 1 ? "Arrive" : `${ride.driver_eta_min} min`}</Text>
              </View>
            )}
          </View>

          {arriving && (
            <View style={styles.arrivingBox} testID="arriving-box">
              <Icon name="bell-ring" size={18} color={theme.color.success} />
              <Text style={styles.arrivingText}>Votre chauffeur arrive dans moins de 2 minutes. Soyez prêt !</Text>
            </View>
          )}

          <RideSummary ride={ride} />

          {ride.scheduled_at && (
            <View style={styles.infoRow}><Icon name="calendar-clock" size={16} color={theme.color.onSurfaceSecondary} /><Text style={styles.infoText}>Programmée : {fmtDateTime(ride.scheduled_at)}</Text></View>
          )}
          {ride.passenger_label && (
            <View style={styles.infoRow}><Icon name="account-outline" size={16} color={theme.color.onSurfaceSecondary} /><Text style={styles.infoText}>Passager : {ride.passenger_label}</Text></View>
          )}

          {ride.driver_name ? (
            <View style={styles.driverCard}>
              {ride.driver_has_photo ? (
                <Image testID="driver-photo" source={{ uri: `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/users/${ride.driver_id}/photo?token=${token}` }} style={styles.avatar} />
              ) : (
                <View style={styles.avatar}><Text style={styles.avatarText}>{ride.driver_name[0]}</Text></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.driverName}>{ride.driver_name}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Icon name="star" size={14} color={theme.color.star} />
                  <Text style={styles.driverRating}>{(ride.driver_rating || 5).toFixed(1)}</Text>
                  {ride.driver_location && <Text style={styles.live}>● GPS live</Text>}
                </View>
              </View>
              <View style={styles.plate}>
                <Text style={styles.plateModel}>{ride.driver_vehicle}</Text>
                <Text style={styles.plateNum}>{ride.driver_plate}</Text>
              </View>
            </View>
          ) : ride.status === "requested" ? (
            <View style={styles.waitingCard}>
              <ActivityIndicator color={theme.color.onSurface} />
              <Text style={styles.waitingText}>
                {ride.scheduled_at ? "Un chauffeur confirmera votre réservation à l'avance." : "Nous recherchons un chauffeur près de vous…"}
                {ride.surcharge_enabled ? " Rallonge activée : votre course est prioritaire." : ""}
              </Text>
            </View>
          ) : null}

          {["requested", "accepted", "in_progress"].includes(ride.status) && ride.share_token && (
            <Pressable testID="share-trip" onPress={shareTrip} style={styles.shareBtn}>
              <Icon name="share-variant-outline" size={18} color={theme.color.onSurface} />
              <Text style={styles.shareText}>Partager mon trajet à un proche</Text>
            </Pressable>
          )}
          {ride.driver_id && ["accepted", "in_progress"].includes(ride.status) && (
            <ChatButton rideId={ride.id} onPress={() => setChatOpen(true)} label={`Écrire à ${ride.driver_name}`} />
          )}
          <RideChat rideId={ride.id} visible={chatOpen} onClose={() => setChatOpen(false)} title={ride.driver_name || "Chauffeur"} canSend={["accepted", "in_progress"].includes(ride.status)} />

          <View style={styles.routeBox}>
            <View style={styles.routeRow}><View style={[styles.dot, { backgroundColor: theme.color.success }]} /><Text style={styles.routeText} numberOfLines={1}>{ride.pickup.address}</Text></View>
            <View style={styles.line} />
            <View style={styles.routeRow}><Icon name="map-marker" size={14} color={theme.color.error} /><Text style={styles.routeText} numberOfLines={1}>{ride.dropoff.address}</Text></View>
            {ride.notes ? <Text style={styles.notes}>📝 {ride.notes}</Text> : null}
          </View>

          <View style={styles.priceBox} testID="ride-price-box">
            <View style={styles.priceRow}><Text style={styles.priceLabel}>Course ({ride.distance_km.toFixed(1)} km)</Text><Text style={styles.priceSmall}>{money(ride.base_price)}</Text></View>
            {ride.surcharge_enabled && (
              <View style={styles.priceRow}><Text style={styles.priceLabel}>Rallonge ({ride.surcharge_km} km × 1,20 €)</Text><Text style={styles.priceSmall}>+{money(ride.surcharge_amount)}</Text></View>
            )}
            {ride.discount_amount > 0 && (
              <View style={styles.priceRow}><Text style={[styles.priceLabel, { color: theme.color.success }]}>Code {ride.promo_code}</Text><Text style={[styles.priceSmall, { color: theme.color.success }]}>−{money(ride.discount_amount)}</Text></View>
            )}
            {ride.cancellation_fee > 0 && (
              <View style={styles.priceRow}><Text style={[styles.priceLabel, { color: theme.color.error }]}>Frais d'annulation</Text><Text style={[styles.priceSmall, { color: theme.color.error }]}>{money(ride.cancellation_fee)}</Text></View>
            )}
            {ride.tip > 0 && (
              <View style={styles.priceRow}><Text style={styles.priceLabel}>Pourboire {ride.tip_paid ? "(payé par carte)" : ride.payment_method === "cash" ? "(en espèces)" : ""}</Text><Text style={styles.priceSmall}>+{money(ride.tip)}</Text></View>
            )}
            <View style={[styles.priceRow, { marginTop: 4 }]}>
              <Text style={styles.priceTotalLabel}>Total</Text>
              <Text style={styles.priceValue}>{money(ride.price)}</Text>
            </View>
            {ride.wallet_amount > 0 && (
              <>
                <View style={styles.priceRow} testID="ride-wallet-row"><Text style={[styles.priceLabel, { color: theme.color.success }]}>Portefeuille récompenses</Text><Text style={[styles.priceSmall, { color: theme.color.success }]}>−{money(ride.wallet_amount)}</Text></View>
                <View style={styles.priceRow}><Text style={[styles.priceLabel, { fontWeight: "700", color: theme.color.onSurface }]}>Reste à payer</Text><Text style={[styles.priceSmall, { fontWeight: "800" }]}>{money(ride.due_amount)}</Text></View>
              </>
            )}
            <View style={styles.payRow}>
              <Icon name={ride.payment_method === "card" ? "credit-card-outline" : "cash"} size={16} color={theme.color.onSurfaceSecondary} />
              <Text style={styles.payText}>
                {ride.payment_method === "card" ? "Carte" : "Espèces"} · {ride.payment_status === "paid" ? "Payé ✓" : ride.payment_status === "pending" ? "En attente" : "À régler"}
              </Text>
            </View>
          </View>

          {showPay && (
            <Pressable testID="pay-card-button" onPress={payByCard} disabled={paying} style={[styles.primary, paying && { opacity: 0.7 }]}>
              {paying ? <ActivityIndicator color="#fff" /> : (
                <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                  <Icon name="lock" size={16} color="#fff" />
                  <Text style={styles.primaryText}>{t("pay_by_card")} • {money(ride.due_amount ?? ride.price)}</Text>
                </View>
              )}
            </Pressable>
          )}

          {ride.status === "completed" && !ride.rating && (
            <ReviewForm paymentMethod={ride.payment_method} submitting={submittingRate} onSubmit={submitRating} />
          )}
          {ride.rating ? (
            <View style={styles.infoRow} testID="my-review">
              <Icon name="star" size={16} color={theme.color.star} />
              <Text style={styles.infoText}>Votre note : {ride.rating}/5{ride.review?.comment ? ` · « ${ride.review.comment} »` : ""}</Text>
            </View>
          ) : null}

          {ride.status === "completed" && ride.payment_status === "paid" && (
            <View style={{ flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.md }}>
              <Pressable testID="receipt-pdf" onPress={() => Linking.openURL(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/rides/${ride.id}/receipt.pdf?token=${token}`)} style={[styles.secondary, { flex: 1, marginBottom: 0 }]}>
                <Icon name="file-pdf-box" size={18} color={theme.color.onSurface} /><Text style={styles.secondaryText}>{t("receipt_pdf")}</Text>
              </Pressable>
              <Pressable testID="receipt-email" onPress={emailReceipt} style={[styles.secondary, { flex: 1, marginBottom: 0 }]}>
                <Icon name="email-fast-outline" size={18} color={theme.color.onSurface} /><Text style={styles.secondaryText}>{t("email_receipt")}</Text>
              </Pressable>
            </View>
          )}
          {receiptMsg ? <Text style={styles.infoText} testID="receipt-msg">{receiptMsg}</Text> : null}

          {["completed", "cancelled"].includes(ride.status) && (
            <Pressable testID="book-again" onPress={() => router.push({ pathname: "/(passenger)", params: { rebook: ride.id } } as any)} style={styles.secondary}>
              <Icon name="refresh" size={18} color={theme.color.onSurface} />
              <Text style={styles.secondaryText}>{t("book_again")}</Text>
            </Pressable>
          )}

          {canCancel && (
            <>
              <Pressable testID="cancel-ride" onPress={cancel} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Annuler la course</Text>
              </Pressable>
              <Text style={styles.cancelHint}>{ride.status === "accepted" ? "⚠️ Frais d'annulation : 3,00 € (chauffeur déjà en route)" : "Annulation gratuite tant qu'aucun chauffeur n'a accepté"}</Text>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  secondary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: theme.spacing.sm, height: 52, borderRadius: theme.radius.pill, borderWidth: 1.5, borderColor: theme.color.onSurface, marginBottom: theme.spacing.md },
  secondaryText: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  root: { flex: 1, backgroundColor: theme.color.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.color.surface },
  back: { position: "absolute", left: theme.spacing.lg, width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: theme.color.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: theme.spacing.xl, paddingTop: theme.spacing.md, maxHeight: "72%" },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: theme.color.borderStrong, marginBottom: theme.spacing.md },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: theme.spacing.md },
  status: { fontSize: 20, fontWeight: "800", color: theme.color.onSurface, flex: 1 },
  etaPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: theme.color.surfaceSecondary, paddingHorizontal: theme.spacing.md, height: 32, borderRadius: theme.radius.pill },
  etaText: { fontSize: 13, fontWeight: "800", color: theme.color.onSurface },
  arrivingBox: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: "#EAF6EE", borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.md },
  arrivingText: { flex: 1, fontSize: 13, fontWeight: "700", color: theme.color.success },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: theme.spacing.sm },
  infoText: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: "600" },
  driverCard: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.lg },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  driverName: { fontSize: 16, fontWeight: "700", color: theme.color.onSurface },
  driverRating: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: "600" },
  live: { fontSize: 11, color: theme.color.success, fontWeight: "700", marginLeft: 6 },
  plate: { alignItems: "flex-end" },
  plateModel: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: "600" },
  plateNum: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  waitingCard: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.lg },
  waitingText: { flex: 1, fontSize: 14, color: theme.color.onSurfaceSecondary, fontWeight: "500" },
  routeBox: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.lg },
  routeRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  routeText: { flex: 1, fontSize: 14, color: theme.color.onSurface, fontWeight: "500" },
  line: { width: 1, height: 12, backgroundColor: theme.color.borderStrong, marginLeft: 4, marginVertical: 6 },
  notes: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: theme.spacing.sm },
  priceBox: { marginBottom: theme.spacing.lg, gap: 4 },
  priceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  priceLabel: { fontSize: 13, color: theme.color.onSurfaceSecondary },
  priceSmall: { fontSize: 13, color: theme.color.onSurface, fontWeight: "600" },
  priceTotalLabel: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
  priceValue: { fontSize: 22, fontWeight: "800", color: theme.color.onSurface },
  payRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  payText: { fontSize: 13, color: theme.color.onSurfaceSecondary, fontWeight: "600" },
  rateBox: { backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.lg, alignItems: "center" },
  rateTitle: { fontSize: 16, fontWeight: "700", marginBottom: theme.spacing.md, color: theme.color.onSurface },
  stars: { flexDirection: "row", gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  tipLabel: { fontSize: 13, fontWeight: "700", color: theme.color.onSurfaceSecondary, marginBottom: theme.spacing.sm },
  tipRow: { flexDirection: "row", gap: 6, marginBottom: theme.spacing.lg, flexWrap: "wrap", justifyContent: "center" },
  tipChip: { paddingHorizontal: theme.spacing.md, height: 36, borderRadius: theme.radius.pill, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: theme.color.border },
  tipChipActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
  tipText: { fontSize: 13, fontWeight: "700", color: theme.color.onSurface },
  primary: { backgroundColor: theme.color.brand, height: 50, paddingHorizontal: theme.spacing.xl, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", alignSelf: "stretch", marginBottom: theme.spacing.md },
  primaryText: { color: "#fff", fontWeight: "800", fontSize: 15 },
  shareBtn: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", height: 44, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, marginBottom: theme.spacing.md },
  shareText: { fontWeight: "700", color: theme.color.onSurface, fontSize: 14 },
  cancelHint: { fontSize: 12, color: theme.color.onSurfaceTertiary, textAlign: "center", marginTop: theme.spacing.sm },
  cancelBtn: { height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  cancelText: { color: theme.color.error, fontWeight: "700", fontSize: 15 },
});

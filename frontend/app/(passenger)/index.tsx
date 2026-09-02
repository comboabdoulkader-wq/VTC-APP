import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList, Alert, Platform, TextInput } from "react-native";
import BottomSheet, { BottomSheetView, BottomSheetTextInput, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import MapCanvas, { MapMarker } from "@/src/components/MapCanvas";
import { POPULAR_PLACES, DEFAULT_PICKUP, Place } from "@/src/data/places";
import { apiFetch, useAuth } from "@/src/context/auth";
import RideOptions, { DEFAULT_OPTIONS, RideOptionsValue, Surcharge } from "@/src/components/passenger/RideOptions";
import { money, fmtDateTime, VEHICLE_ICON } from "@/src/utils/format";

type Estimate = { vehicle_type: "standard" | "premium" | "van"; label: string; price: number; distance_km: number; duration_min: number; eta_min: number };
type CartItem = { key: string; pickup: Place; dropoff: Place; vehicle: Estimate; options: RideOptionsValue; surcharge: Surcharge };
const SheetInput: any = Platform.OS === "web" ? TextInput : BottomSheetTextInput;

const toPayload = (it: CartItem) => ({
  pickup: { lat: it.pickup.lat, lng: it.pickup.lng, address: it.pickup.address },
  dropoff: { lat: it.dropoff.lat, lng: it.dropoff.lng, address: it.dropoff.address },
  vehicle_type: it.vehicle.vehicle_type,
  surcharge_enabled: it.options.surchargeEnabled,
  scheduled_at: it.options.scheduledAt ? it.options.scheduledAt.toISOString() : null,
  passenger_label: it.options.forOther ? it.options.passengerLabel.trim() || "Un proche" : null,
  notes: it.options.notes.trim() || null,
  payment_method: it.options.paymentMethod,
});
const itemTotal = (it: CartItem) => it.vehicle.price + (it.options.surchargeEnabled ? it.surcharge.amount : 0);

export default function PassengerHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const sheetRef = useRef<BottomSheet>(null);

  const [pickup, setPickup] = useState<Place>(DEFAULT_PICKUP);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [searchMode, setSearchMode] = useState<"pickup" | "dropoff">("dropoff");
  const [query, setQuery] = useState("");
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [surcharge, setSurcharge] = useState<Surcharge | null>(null);
  const [selected, setSelected] = useState<Estimate | null>(null);
  const [options, setOptions] = useState<RideOptionsValue>(DEFAULT_OPTIONS);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [activeCount, setActiveCount] = useState(0);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [cardEnabled, setCardEnabled] = useState(false);

  const snapPoints = useMemo(() => ["30%", "62%", "92%"], []);

  useEffect(() => { apiFetch<{ card_enabled: boolean }>("/payments/config").then((c) => setCardEnabled(c.card_enabled)).catch(() => {}); }, []);

  useFocusEffect(useCallback(() => {
    let alive = true;
    apiFetch<any[]>("/rides/active-list", {}, token).then((r) => alive && setActiveCount(r.length)).catch(() => {});
    return () => { alive = false; };
  }, [token]));

  const markers: MapMarker[] = useMemo(() => {
    const arr: MapMarker[] = [{ id: "p", type: "pickup", coordinate: { latitude: pickup.lat, longitude: pickup.lng } }];
    if (dropoff) arr.push({ id: "d", type: "dropoff", coordinate: { latitude: dropoff.lat, longitude: dropoff.lng } });
    return arr;
  }, [pickup, dropoff]);

  const allPlaces = useMemo(() => [DEFAULT_PICKUP, ...POPULAR_PLACES], []);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const src = searchMode === "pickup" ? allPlaces : POPULAR_PLACES;
    if (!q) return src;
    return src.filter((p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q));
  }, [query, searchMode, allPlaces]);

  const loadEstimate = async (from: Place, to: Place) => {
    setLoadingEstimate(true);
    try {
      const res = await apiFetch<{ options: Estimate[]; surcharge: Surcharge }>("/rides/estimate", {
        method: "POST",
        body: JSON.stringify({ pickup: { lat: from.lat, lng: from.lng, address: from.address }, dropoff: { lat: to.lat, lng: to.lng, address: to.address } }),
      }, token);
      setEstimates(res.options);
      setSurcharge(res.surcharge);
      setSelected((prev) => res.options.find((o) => o.vehicle_type === prev?.vehicle_type) || res.options[0]);
    } catch {} finally { setLoadingEstimate(false); }
  };

  const choosePlace = async (p: Place) => {
    setQuery("");
    if (searchMode === "pickup") {
      setPickup(p);
      setSearchMode("dropoff");
      if (dropoff) loadEstimate(p, dropoff);
      return;
    }
    setDropoff(p);
    setOptions(DEFAULT_OPTIONS);
    sheetRef.current?.snapToIndex(2);
    await loadEstimate(pickup, p);
  };

  const reset = () => { setDropoff(null); setEstimates([]); setSelected(null); setSurcharge(null); setOptions(DEFAULT_OPTIONS); setSearchMode("dropoff"); };

  const currentItem = (): CartItem | null => (dropoff && selected && surcharge)
    ? { key: `${Date.now()}`, pickup, dropoff, vehicle: selected, options, surcharge } : null;

  const orderNow = async () => {
    const it = currentItem();
    if (!it) return;
    setConfirming(true);
    try {
      const ride = await apiFetch<any>("/rides", { method: "POST", body: JSON.stringify(toPayload(it)) }, token);
      reset();
      router.push(`/(passenger)/ride/${ride.id}`);
    } catch (e: any) { Alert.alert("Erreur", e.message); } finally { setConfirming(false); }
  };

  const addToCart = () => {
    const it = currentItem();
    if (!it) return;
    setCart((c) => [...c, it]);
    reset();
    setShowCart(true);
    sheetRef.current?.snapToIndex(1);
  };

  const orderCart = async () => {
    if (!cart.length) return;
    setConfirming(true);
    try {
      const rides = await apiFetch<any[]>("/rides/batch", { method: "POST", body: JSON.stringify({ rides: cart.map(toPayload) }) }, token);
      setCart([]); setShowCart(false);
      if (rides.length === 1) router.push(`/(passenger)/ride/${rides[0].id}`);
      else router.push("/(passenger)/rides");
    } catch (e: any) { Alert.alert("Erreur", e.message); } finally { setConfirming(false); }
  };

  const cartTotal = cart.reduce((s, it) => s + itemTotal(it), 0);

  return (
    <View style={styles.root} testID="passenger-home">
      <MapCanvas region={{ latitude: pickup.lat, longitude: pickup.lng, latitudeDelta: 0.08, longitudeDelta: 0.08 }} markers={markers} />

      <View style={[styles.topBar, { top: insets.top + theme.spacing.md }]}>
        <Pressable testID="pickup-chip" onPress={() => { setSearchMode("pickup"); setShowCart(false); sheetRef.current?.snapToIndex(2); }} style={styles.locChip}>
          <Icon name="crosshairs-gps" size={16} color={theme.color.success} />
          <Text style={styles.locChipText} numberOfLines={1}>{pickup.name}</Text>
          <Icon name="pencil-outline" size={14} color={theme.color.onSurfaceTertiary} />
        </Pressable>
        {cart.length > 0 && (
          <Pressable testID="cart-chip" onPress={() => { setShowCart(true); sheetRef.current?.snapToIndex(1); }} style={styles.cartChip}>
            <Icon name="cart-outline" size={16} color="#fff" />
            <Text style={styles.cartChipText}>{cart.length}</Text>
          </Pressable>
        )}
      </View>

      {activeCount > 0 && (
        <Pressable testID="active-ride-banner" onPress={() => router.push("/(passenger)/rides")} style={[styles.activeBanner, { top: insets.top + 64 }]}>
          <Icon name="car-clock" size={20} color="#fff" />
          <Text style={styles.activeBannerText}>{activeCount} course{activeCount > 1 ? "s" : ""} en cours – Suivre</Text>
          <Icon name="chevron-right" size={20} color="#fff" />
        </Pressable>
      )}

      <BottomSheet ref={sheetRef} index={0} snapPoints={snapPoints} keyboardBehavior="interactive"
        handleIndicatorStyle={{ backgroundColor: theme.color.borderStrong }} backgroundStyle={{ backgroundColor: theme.color.surface }}>
        {showCart ? (
          <BottomSheetScrollView contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + theme.spacing.lg }]}>
            <View style={styles.rowBetween}>
              <Text style={styles.sheetTitle}>Vos commandes ({cart.length})</Text>
              <Pressable testID="cart-close" onPress={() => setShowCart(false)} hitSlop={10}><Icon name="close" size={22} color={theme.color.onSurfaceSecondary} /></Pressable>
            </View>
            {cart.map((it, i) => (
              <View key={it.key} style={styles.cartItem} testID={`cart-item-${i}`}>
                <View style={styles.vehicleIcon}><Icon name={VEHICLE_ICON[it.vehicle.vehicle_type] as any} size={22} color={theme.color.onSurface} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cartRoute} numberOfLines={1}>{it.pickup.name} → {it.dropoff.name}</Text>
                  <Text style={styles.cartMeta}>
                    {it.options.scheduledAt ? fmtDateTime(it.options.scheduledAt) : "Maintenant"}
                    {it.options.forOther ? ` · ${it.options.passengerLabel || "Un proche"}` : ""}
                    {it.options.surchargeEnabled ? " · Rallonge" : ""}
                  </Text>
                </View>
                <Text style={styles.cartPrice}>{money(itemTotal(it))}</Text>
                <Pressable testID={`cart-remove-${i}`} onPress={() => setCart((c) => c.filter((x) => x.key !== it.key))} hitSlop={8}>
                  <Icon name="trash-can-outline" size={20} color={theme.color.error} />
                </Pressable>
              </View>
            ))}
            <Pressable testID="cart-add-more" onPress={() => { setShowCart(false); sheetRef.current?.snapToIndex(2); }} style={styles.secondaryBtn}>
              <Icon name="plus" size={18} color={theme.color.onSurface} />
              <Text style={styles.secondaryText}>Ajouter une autre course</Text>
            </Pressable>
            <Pressable testID="cart-order-all" disabled={!cart.length || confirming} onPress={orderCart} style={[styles.confirmBtn, (!cart.length || confirming) && { opacity: 0.5 }]}>
              {confirming ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText}>Commander tout ({cart.length}) • {money(cartTotal)}</Text>}
            </Pressable>
          </BottomSheetScrollView>
        ) : !dropoff || searchMode === "pickup" ? (
          <BottomSheetView style={[styles.sheetContent, { flex: 1, paddingBottom: insets.bottom + theme.spacing.lg }]}>
            <View style={styles.rowBetween}>
              <Text style={styles.sheetTitle}>{searchMode === "pickup" ? "Point de départ" : "Où allez-vous ?"}</Text>
              {searchMode === "pickup" && (
                <Pressable testID="pickup-cancel" onPress={() => setSearchMode("dropoff")} hitSlop={10}><Icon name="close" size={22} color={theme.color.onSurfaceSecondary} /></Pressable>
              )}
            </View>
            <View style={styles.searchWrap}>
              <Icon name="magnify" size={20} color={theme.color.onSurfaceTertiary} />
              <SheetInput testID="destination-search" value={query} onChangeText={setQuery}
                placeholder={searchMode === "pickup" ? "Adresse de départ" : "Rechercher une adresse"}
                placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.searchInput} onFocus={() => sheetRef.current?.snapToIndex(2)} />
            </View>
            <FlatList data={results} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable testID={`place-${item.id}`} style={styles.placeRow} onPress={() => choosePlace(item)}>
                  <View style={styles.placeIcon}><Icon name={item.id === "current" ? "crosshairs-gps" : "map-marker-outline"} size={22} color={theme.color.onSurface} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.placeName}>{item.name}</Text>
                    <Text style={styles.placeAddr} numberOfLines={1}>{item.address}</Text>
                  </View>
                </Pressable>
              )} />
          </BottomSheetView>
        ) : (
          <BottomSheetScrollView contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + theme.spacing.lg }]} keyboardShouldPersistTaps="handled">
            <View style={styles.trip}>
              <Icon name="dots-vertical" size={22} color={theme.color.onSurfaceTertiary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.tripLabel}>Départ</Text>
                <Text style={styles.tripAddr} numberOfLines={1}>{pickup.name}</Text>
                <View style={styles.tripDivider} />
                <Text style={styles.tripLabel}>Arrivée</Text>
                <Text style={styles.tripAddr} numberOfLines={1}>{dropoff.name}</Text>
              </View>
              <Pressable testID="reset-dropoff" onPress={reset} hitSlop={8}><Icon name="close" size={22} color={theme.color.onSurfaceSecondary} /></Pressable>
            </View>

            <Text style={styles.sectionTitle}>Choisissez votre véhicule</Text>
            {loadingEstimate ? <ActivityIndicator style={{ marginVertical: 30 }} color={theme.color.onSurface} /> : (
              <View style={{ gap: theme.spacing.sm }}>
                {estimates.map((e) => {
                  const active = selected?.vehicle_type === e.vehicle_type;
                  return (
                    <Pressable key={e.vehicle_type} testID={`vehicle-${e.vehicle_type}`} onPress={() => setSelected(e)} style={[styles.vehicleRow, active && styles.vehicleRowActive]}>
                      <View style={styles.vehicleIcon}><Icon name={VEHICLE_ICON[e.vehicle_type] as any} size={26} color={theme.color.onSurface} /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.vehicleName}>{e.label}</Text>
                        <Text style={styles.vehicleMeta}>{e.eta_min} min d'attente • {e.duration_min} min • {e.distance_km.toFixed(1)} km</Text>
                      </View>
                      <Text style={styles.vehiclePrice}>{money(e.price)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {selected && surcharge && (
              <RideOptions value={options} onChange={setOptions} surcharge={surcharge} basePrice={selected.price} cardEnabled={cardEnabled} />
            )}

            <Pressable testID="confirm-ride-button" disabled={!selected || confirming} onPress={orderNow}
              style={({ pressed }) => [styles.confirmBtn, (!selected || confirming) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}>
              {confirming ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.confirmText}>
                  {options.scheduledAt ? "Programmer" : "Commander"} {selected ? `• ${money(selected.price + (options.surchargeEnabled && surcharge ? surcharge.amount : 0))}` : ""}
                </Text>
              )}
            </Pressable>
            <Pressable testID="add-to-cart-button" disabled={!selected} onPress={addToCart} style={[styles.secondaryBtn, !selected && { opacity: 0.5 }]}>
              <Icon name="cart-plus" size={18} color={theme.color.onSurface} />
              <Text style={styles.secondaryText}>Ajouter au panier (commandes multiples)</Text>
            </Pressable>
          </BottomSheetScrollView>
        )}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  topBar: { position: "absolute", left: theme.spacing.lg, right: theme.spacing.lg, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  locChip: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surface, paddingHorizontal: theme.spacing.md, height: 40, borderRadius: theme.radius.pill, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3, maxWidth: "75%" },
  locChipText: { color: theme.color.onSurface, fontWeight: "600", fontSize: 13, flexShrink: 1 },
  cartChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.color.brand, paddingHorizontal: theme.spacing.md, height: 40, borderRadius: theme.radius.pill, elevation: 3 },
  cartChipText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  activeBanner: { position: "absolute", left: theme.spacing.lg, right: theme.spacing.lg, backgroundColor: theme.color.success, flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderRadius: theme.radius.md },
  activeBannerText: { color: "#fff", fontWeight: "700", flex: 1 },
  sheetContent: { paddingHorizontal: theme.spacing.xl },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 22, fontWeight: "800", color: theme.color.onSurface, marginTop: theme.spacing.sm, marginBottom: theme.spacing.md },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 52, marginBottom: theme.spacing.md },
  searchInput: { flex: 1, fontSize: 16, color: theme.color.onSurface, height: "100%" },
  placeRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  placeIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  placeName: { fontSize: 15, fontWeight: "600", color: theme.color.onSurface },
  placeAddr: { fontSize: 13, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  trip: { flexDirection: "row", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.md, marginTop: theme.spacing.sm, alignItems: "center" },
  tripLabel: { fontSize: 11, color: theme.color.onSurfaceTertiary, fontWeight: "600", textTransform: "uppercase" },
  tripAddr: { fontSize: 15, color: theme.color.onSurface, fontWeight: "600", marginTop: 2 },
  tripDivider: { height: 1, backgroundColor: theme.color.border, marginVertical: theme.spacing.sm },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: theme.color.onSurface, marginTop: theme.spacing.xl, marginBottom: theme.spacing.md },
  vehicleRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, padding: theme.spacing.md, borderRadius: theme.radius.md, borderWidth: 2, borderColor: "transparent", backgroundColor: theme.color.surfaceSecondary },
  vehicleRowActive: { borderColor: theme.color.onSurface, backgroundColor: theme.color.surface },
  vehicleIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center" },
  vehicleName: { fontSize: 16, fontWeight: "700", color: theme.color.onSurface },
  vehicleMeta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  vehiclePrice: { fontSize: 17, fontWeight: "800", color: theme.color.onSurface },
  confirmBtn: { backgroundColor: theme.color.brand, height: 56, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.lg },
  confirmText: { color: theme.color.onBrand, fontWeight: "800", fontSize: 16 },
  secondaryBtn: { flexDirection: "row", gap: theme.spacing.sm, height: 48, borderRadius: theme.radius.pill, alignItems: "center", justifyContent: "center", marginTop: theme.spacing.md, borderWidth: 1.5, borderColor: theme.color.borderStrong },
  secondaryText: { color: theme.color.onSurface, fontWeight: "700", fontSize: 14 },
  cartItem: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, padding: theme.spacing.md, marginBottom: theme.spacing.sm },
  cartRoute: { fontSize: 14, fontWeight: "700", color: theme.color.onSurface },
  cartMeta: { fontSize: 12, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  cartPrice: { fontSize: 15, fontWeight: "800", color: theme.color.onSurface },
});

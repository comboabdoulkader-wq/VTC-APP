import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, FlatList, Alert, Platform, TextInput } from "react-native";
import BottomSheet, { BottomSheetView, BottomSheetTextInput, BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import { useResponsive } from "@/src/hooks/useResponsive";
import MapCanvas, { MapMarker } from "@/src/components/MapCanvas";
import { POPULAR_PLACES, DEFAULT_PICKUP, Place } from "@/src/data/places";
import { apiFetch, useAuth } from "@/src/context/auth";
import RideOptions, { DEFAULT_OPTIONS, RideOptionsValue, Surcharge, Budget } from "@/src/components/passenger/RideOptions";
import BookingWizard from "@/src/components/passenger/BookingWizard";
import { useMyPosition } from "@/src/hooks/useMyPosition";
import { useAddressSearch } from "@/src/hooks/useAddressSearch";
import SheetModal from "@/src/components/ui/SheetModal";
import { money, fmtDateTime, VEHICLE_ICON } from "@/src/utils/format";
import ServicePicker, { Service } from "@/src/components/passenger/ServicePicker";
import TripDetails, { DEFAULT_TRIP, TripDetailsValue } from "@/src/components/passenger/TripDetails";
import VehicleCard, { VehicleOption } from "@/src/components/passenger/VehicleCard";

type Estimate = VehicleOption;
type CartItem = { key: string; pickup: Place; dropoff: Place; stops: Place[]; vehicle: Estimate; options: RideOptionsValue; surcharge: Surcharge; service: string; trip: TripDetailsValue };
const SheetInput: any = Platform.OS === "web" ? TextInput : BottomSheetTextInput;

const toPayload = (it: CartItem) => ({
  pickup: { lat: it.pickup.lat, lng: it.pickup.lng, address: it.pickup.address },
  dropoff: { lat: it.dropoff.lat, lng: it.dropoff.lng, address: it.dropoff.address },
  stops: (it.stops || []).map((s) => ({ lat: s.lat, lng: s.lng, address: s.address })),
  vehicle_type: it.vehicle.vehicle_type,
  surcharge_enabled: it.options.surchargeEnabled,
  scheduled_at: it.options.scheduledAt ? it.options.scheduledAt.toISOString() : null,
  passenger_label: it.options.forOther ? it.options.passengerLabel.trim() || "Un proche" : null,
  notes: it.options.notes.trim() || null,
  payment_method: it.options.paymentMethod,
  business: it.options.business,
  promo_code: it.options.promoCode || null,
  use_wallet: it.options.useWallet && !it.options.business,
  service_type: it.service,
  hours: it.trip.hours,
  passengers: it.trip.passengers,
  children: it.trip.children,
  child_seats: it.trip.childSeats,
  luggage: it.trip.luggage,
  flight_number: it.service === "airport" && it.trip.flightNumber.trim() ? it.trip.flightNumber.trim() : null,
  airline: it.service === "airport" && it.trip.airline.trim() ? it.trip.airline.trim() : null,
});
const tripPayload = (service: string, trip: TripDetailsValue, minHours: number) => ({
  service_type: service, hours: Math.max(trip.hours, minHours), passengers: trip.passengers, children: trip.children, luggage: trip.luggage,
});
const itemTotal = (it: CartItem) => Math.max(it.vehicle.price + (it.options.surchargeEnabled ? it.surcharge.amount : 0) - (it.options.promoCode ? it.options.discount : 0), 0);

export default function PassengerHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token } = useAuth();
  const sheetRef = useRef<BottomSheet>(null);

  const [pickup, setPickup] = useState<Place>(DEFAULT_PICKUP);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [stops, setStops] = useState<Place[]>([]);
  const [stopPickerOpen, setStopPickerOpen] = useState(false);
  const [stopQuery, setStopQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"pickup" | "dropoff">("dropoff");
  const [query, setQuery] = useState("");
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [surcharge, setSurcharge] = useState<Surcharge | null>(null);
  const [selected, setSelected] = useState<Estimate | null>(null);
  const [options, setOptions] = useState<RideOptionsValue>(DEFAULT_OPTIONS);
  const [loadingEstimate, setLoadingEstimate] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [wizardDone, setWizardDone] = useState(false);
  const [activeCount, setActiveCount] = useState(0);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [cardEnabled, setCardEnabled] = useState(false);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [services, setServices] = useState<Service[]>([]);
  const [service, setService] = useState("private");
  const [trip, setTrip] = useState<TripDetailsValue>(DEFAULT_TRIP);
  const [flightTracking, setFlightTracking] = useState(false);
  const [cancelPolicy, setCancelPolicy] = useState("");
  const { rebook } = useLocalSearchParams<{ rebook?: string }>();
  const currentService = services.find((s) => s.key === service) || null;
  const minHours = currentService?.pricing === "hourly" ? currentService.min_hours : 0;
  const gps = useMyPosition();
  const { t, lang } = useI18n();
  const [favorites, setFavorites] = useState<(Place & { label: string; icon: string })[]>([]);
  const [saveFav, setSaveFav] = useState<Place | null>(null);
  const [favLabel, setFavLabel] = useState("Maison");
  const [favCustom, setFavCustom] = useState("");
  const loadFavorites = useCallback(() => apiFetch<any[]>("/favorites", {}, token).then((l) => setFavorites(l.map((f) => ({ id: `fav-${f.id}`, favId: f.id, name: f.label, address: f.address, lat: f.lat, lng: f.lng, label: f.label, icon: f.icon })))).catch(() => {}), [token]);
  const saveFavorite = async () => {
    if (!saveFav) return;
    const label = favLabel === "Autre" ? favCustom.trim() || "Autre" : favLabel;
    try {
      await apiFetch("/favorites", { method: "POST", body: JSON.stringify({ label, name: saveFav.name, address: saveFav.address, lat: saveFav.lat, lng: saveFav.lng, icon: favLabel === "Maison" ? "home" : favLabel === "Travail" ? "briefcase" : "star" }) }, token);
      setSaveFav(null); setFavCustom(""); loadFavorites();
    } catch (e: any) { Alert.alert("Erreur", e.message); }
  };
  const removeFavorite = async (favId: string) => { try { await apiFetch(`/favorites/${favId}`, { method: "DELETE" }, token); loadFavorites(); } catch {} };
  const { results: geoResults, searching } = useAddressSearch(query, pickup);
  const { results: stopResults, searching: stopSearching } = useAddressSearch(stopQuery, pickup);

  // GPS position becomes the default pickup as soon as it is known
  useEffect(() => { if (gps.place && pickup.id !== "gps") setPickup(gps.place); }, [gps.place]);

  const { height: winH, isShort } = useResponsive();
  // Absolute minimums keep the search field reachable on short/landscape screens (30 % of 390 px would be 117 px).
  const snapPoints = useMemo(() => [Math.max(winH * 0.3, 230), Math.max(winH * 0.62, isShort ? winH - 80 : 420), winH * 0.92], [winH, isShort]);

  useEffect(() => {
    apiFetch<{ card_enabled: boolean }>("/payments/config").then((c) => setCardEnabled(c.card_enabled)).catch(() => {});
    apiFetch<any>(`/catalog?lang=${lang}`).then((c) => { setServices(c.services); setFlightTracking(!!c.flight_tracking); setCancelPolicy(c.cancellation_policy?.text || ""); }).catch(() => {});
  }, [lang]);

  // "Réserver à nouveau": prefill pickup/dropoff/service/details from a past ride
  useEffect(() => {
    if (!rebook || !token) return;
    apiFetch<any>(`/rides/${rebook}`, {}, token).then(async (r) => {
      const from: Place = { id: `rb-p-${r.id}`, name: r.pickup.address.split(",")[0], address: r.pickup.address, lat: r.pickup.lat, lng: r.pickup.lng };
      const to: Place = { id: `rb-d-${r.id}`, name: r.dropoff.address.split(",")[0], address: r.dropoff.address, lat: r.dropoff.lat, lng: r.dropoff.lng };
      const t: TripDetailsValue = { passengers: r.passengers || 1, children: r.children || 0, childSeats: r.child_seats || 0, luggage: r.luggage || 0, hours: r.hours || 0, flightNumber: r.flight?.number || "", airline: r.flight?.airline || "" };
      setPickup(from); setService(r.service_type || "private"); setTrip(t); setDropoff(to); setShowCart(false); setSearchMode("dropoff"); setWizardDone(true);
      sheetRef.current?.snapToIndex(2);
      await loadEstimate(from, to, r.service_type || "private", t, r.vehicle_type);
      router.setParams({ rebook: undefined } as any);
    }).catch(() => {});
  }, [rebook, token]);

  useFocusEffect(useCallback(() => {
    let alive = true;
    apiFetch<any[]>("/rides/active-list", {}, token).then((r) => alive && setActiveCount(r.length)).catch(() => {});
    apiFetch<any>("/company/my-budget", {}, token).then((b) => alive && setBudget(b.company ? b : null)).catch(() => {});
    apiFetch<any>("/wallet", {}, token).then((w) => alive && setWalletBalance(w.balance || 0)).catch(() => {});
    loadFavorites();
    return () => { alive = false; };
  }, [token]));

  const markers: MapMarker[] = useMemo(() => {
    const arr: MapMarker[] = [{ id: "p", type: "pickup", coordinate: { latitude: pickup.lat, longitude: pickup.lng } }];
    if (dropoff) arr.push({ id: "d", type: "dropoff", coordinate: { latitude: dropoff.lat, longitude: dropoff.lng } });
    return arr;
  }, [pickup, dropoff]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = searchMode === "pickup" ? [gps.place || DEFAULT_PICKUP, ...favorites, ...POPULAR_PLACES] : [...favorites, ...POPULAR_PLACES];
    if (!q) return base;
    const local = base.filter((p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q));
    const seen = new Set(local.map((p) => p.id));
    return [...local, ...geoResults.filter((p) => !seen.has(p.id))];
  }, [query, searchMode, gps.place, geoResults, favorites]);

  const loadEstimate = async (from: Place, to: Place, svc = service, t = trip, preferVehicle?: string) => {
    setLoadingEstimate(true);
    try {
      const mh = services.find((s) => s.key === svc)?.pricing === "hourly" ? services.find((s) => s.key === svc)!.min_hours : 0;
      const res = await apiFetch<{ options: Estimate[]; surcharge: Surcharge; hours: number }>("/rides/estimate", {
        method: "POST",
        body: JSON.stringify({ pickup: { lat: from.lat, lng: from.lng, address: from.address }, dropoff: { lat: to.lat, lng: to.lng, address: to.address }, stops: stops.map((s) => ({ lat: s.lat, lng: s.lng, address: s.address })), ...tripPayload(svc, t, mh) }),
      }, token);
      setEstimates(res.options);
      setSurcharge(res.surcharge);
      if (res.hours && res.hours !== t.hours) setTrip((prev) => ({ ...prev, hours: res.hours }));
      setSelected((prev) => {
        const want = preferVehicle || prev?.vehicle_type;
        const keep = res.options.find((o) => o.vehicle_type === want && o.fits !== false);
        return keep || res.options.find((o) => o.fits !== false) || null;
      });
    } catch {} finally { setLoadingEstimate(false); }
  };

  // Re-estimate when service / passengers / luggage / hours change
  const tripKey = `${service}|${trip.passengers}|${trip.children}|${trip.luggage}|${trip.hours}|${stops.map((s) => s.id).join(",")}`;
  useEffect(() => { if (dropoff) loadEstimate(pickup, dropoff); }, [tripKey]);

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

  const useGps = async () => {
    if (gps.status === "blocked") { gps.openSettings(); return; }
    if (gps.place) { setPickup(gps.place); setSearchMode("dropoff"); if (dropoff) loadEstimate(gps.place, dropoff); return; }
    const ok = await gps.request();
    if (ok) setSearchMode("dropoff");
  };

  const reset = () => { setDropoff(null); setStops([]); setEstimates([]); setSelected(null); setSurcharge(null); setOptions((o) => ({ ...DEFAULT_OPTIONS, business: o.business, scheduledAt: o.scheduledAt })); setTrip(DEFAULT_TRIP); setSearchMode("dropoff"); };

  const onWizardDone = (business: boolean, schedule: Date | null) => {
    setOptions((o) => ({ ...o, business, scheduledAt: schedule, paymentMethod: business ? "cash" : o.paymentMethod }));
    setWizardDone(true);
    setShowCart(false);
    setSearchMode("dropoff");
    sheetRef.current?.snapToIndex(2);
  };

  const currentItem = (): CartItem | null => (dropoff && selected && surcharge)
    ? { key: `${Date.now()}`, pickup, dropoff, stops, vehicle: selected, options, surcharge, service, trip: { ...trip, hours: Math.max(trip.hours, minHours) } } : null;

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
          <Icon name={pickup.id === "gps" ? "crosshairs-gps" : "map-marker"} size={16} color={pickup.id === "gps" ? theme.color.success : theme.color.onSurface} />
          <Text style={styles.locChipText} numberOfLines={1}>{pickup.id === "gps" ? pickup.address : pickup.name}</Text>
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
              {confirming ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmText} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>Commander tout ({cart.length}) • {money(cartTotal)}</Text>}
            </Pressable>
          </BottomSheetScrollView>
        ) : !dropoff || searchMode === "pickup" ? (
          <BottomSheetView style={[styles.sheetContent, { flex: 1, paddingBottom: insets.bottom + theme.spacing.lg }]}>
            <View style={styles.rowBetween}>
              <Text style={styles.sheetTitle}>{searchMode === "pickup" ? t("pickup_point") : t("where_to")}</Text>
              {searchMode === "pickup" && (
                <Pressable testID="pickup-cancel" onPress={() => setSearchMode("dropoff")} hitSlop={10}><Icon name="close" size={22} color={theme.color.onSurfaceSecondary} /></Pressable>
              )}
            </View>
            {searchMode === "dropoff" && services.length > 0 && (
              <ServicePicker services={services} value={service} onChange={(sv) => { setService(sv.key); setTrip((t) => ({ ...t, hours: sv.pricing === "hourly" ? Math.max(t.hours, sv.min_hours) : 0 })); }} />
            )}
            {searchMode === "pickup" && (
              <Pressable testID="use-gps" onPress={useGps} style={styles.gpsRow}>
                <View style={[styles.placeIcon, { backgroundColor: "#EAF6EE" }]}>
                  {gps.status === "locating" ? <ActivityIndicator size="small" color={theme.color.success} /> : <Icon name="crosshairs-gps" size={22} color={theme.color.success} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.placeName}>{gps.status === "blocked" ? "Localisation bloquée – ouvrir les réglages" : gps.place ? "Utiliser ma position GPS" : "Activer ma position GPS"}</Text>
                  <Text style={styles.placeAddr} numberOfLines={1}>
                    {gps.status === "denied" ? "Autorisez la localisation pour être pris en charge exactement où vous êtes" : gps.place ? gps.place.address : "Prise en charge exacte à votre emplacement"}
                  </Text>
                </View>
              </Pressable>
            )}
            <View style={styles.searchWrap}>
              {searching ? <ActivityIndicator size="small" color={theme.color.onSurfaceTertiary} /> : <Icon name="magnify" size={20} color={theme.color.onSurfaceTertiary} />}
              <SheetInput testID="destination-search" value={query} onChangeText={setQuery}
                placeholder={searchMode === "pickup" ? t("pickup_point") : t("search_placeholder")}
                placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.searchInput} onFocus={() => sheetRef.current?.snapToIndex(2)} />
            </View>
            <FlatList data={results} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.placeAddr}>{searching ? "Recherche…" : query.trim().length >= 3 ? "Aucune adresse trouvée" : "Tapez au moins 3 caractères"}</Text>}
              renderItem={({ item }) => (
                <Pressable testID={`place-${item.id}`} style={styles.placeRow} onPress={() => choosePlace(item)}>
                  <View style={styles.placeIcon}><Icon name={item.id === "gps" ? "crosshairs-gps" : item.id === "current" ? "city-variant-outline" : (item as any).icon || "map-marker-outline"} size={22} color={(item as any).favId ? theme.color.star : theme.color.onSurface} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.placeName}>{item.name}</Text>
                    <Text style={styles.placeAddr} numberOfLines={1}>{item.address}</Text>
                  </View>
                  {(item as any).favId ? (
                    <Pressable testID={`fav-delete-${(item as any).favId}`} onPress={() => removeFavorite((item as any).favId)} hitSlop={8}><Icon name="trash-can-outline" size={18} color={theme.color.onSurfaceTertiary} /></Pressable>
                  ) : query.trim().length >= 3 || item.id !== "current" ? (
                    <Pressable testID={`fav-save-${item.id}`} onPress={() => { setSaveFav(item); setFavLabel("Maison"); }} hitSlop={8}><Icon name="star-outline" size={18} color={theme.color.onSurfaceTertiary} /></Pressable>
                  ) : null}
                </Pressable>
              )} />
          </BottomSheetView>
        ) : (
          <BottomSheetScrollView contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + theme.spacing.lg }]} keyboardShouldPersistTaps="handled">
            <Pressable testID="wizard-summary" onPress={() => setWizardDone(false)} style={styles.summaryBar}>
              <View style={styles.summaryChip}><Icon name={options.business ? "office-building" : "account"} size={14} color={theme.color.onSurface} /><Text style={styles.summaryText}>{options.business ? "Professionnelle" : "Privée"}</Text></View>
              <View style={styles.summaryChip}><Icon name={options.scheduledAt ? "calendar-clock" : "lightning-bolt"} size={14} color={theme.color.onSurface} /><Text style={styles.summaryText}>{options.scheduledAt ? fmtDateTime(options.scheduledAt) : "Immédiate"}</Text></View>
              <View style={{ flex: 1 }} />
              <Icon name="pencil-outline" size={16} color={theme.color.brand} />
            </Pressable>
            <View style={styles.trip}>
              <Icon name="dots-vertical" size={22} color={theme.color.onSurfaceTertiary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.tripLabel}>{t("departure")}</Text>
                <Text style={styles.tripAddr} numberOfLines={1}>{pickup.name}</Text>
                <View style={styles.tripDivider} />
                <Text style={styles.tripLabel}>{t("arrival")}</Text>
                <Text style={styles.tripAddr} numberOfLines={1}>{dropoff.name}</Text>
              </View>
              <Pressable testID="reset-dropoff" onPress={reset} hitSlop={8}><Icon name="close" size={22} color={theme.color.onSurfaceSecondary} /></Pressable>
            </View>

            {stops.map((s, i) => (
              <View key={s.id} style={styles.stopRow} testID={`home-stop-${i}`}>
                <Icon name="map-marker-path" size={18} color={theme.color.onSurfaceSecondary} />
                <Text style={styles.stopText} numberOfLines={1}>Arrêt {i + 1} · {s.name}</Text>
                <Pressable testID={`home-stop-up-${i}`} onPress={() => setStops((a) => { const b = [...a]; if (i > 0) { [b[i - 1], b[i]] = [b[i], b[i - 1]]; } return b; })} hitSlop={6}><Icon name="chevron-up" size={20} color={theme.color.onSurfaceTertiary} /></Pressable>
                <Pressable testID={`home-stop-del-${i}`} onPress={() => setStops((a) => a.filter((_, idx) => idx !== i))} hitSlop={6}><Icon name="close" size={18} color={theme.color.error} /></Pressable>
              </View>
            ))}
            {stops.length < 8 && (
              <Pressable testID="home-add-stop" onPress={() => { setStopQuery(""); setStopPickerOpen(true); }} style={styles.addStopBtn}>
                <Icon name="plus" size={18} color={theme.color.onSurface} /><Text style={styles.secondaryText}>Ajouter un arrêt</Text>
              </Pressable>
            )}

            {services.length > 0 && (
              <ServicePicker services={services} value={service} onChange={(sv) => { setService(sv.key); setTrip((t) => ({ ...t, hours: sv.pricing === "hourly" ? Math.max(t.hours, sv.min_hours) : 0 })); }} />
            )}
            <TripDetails value={trip} onChange={setTrip} service={currentService} flightTracking={flightTracking} />

            <Text style={styles.sectionTitle}>{t("choose_vehicle")}</Text>
            {estimates[0]?.fixed_route_name ? <Text style={styles.fixedRoute} testID="fixed-route-name">✓ {t("fixed_route", { name: estimates[0].fixed_route_name })}</Text> : null}
            {loadingEstimate ? <ActivityIndicator style={{ marginVertical: 30 }} color={theme.color.onSurface} /> : (
              <View style={{ gap: theme.spacing.sm }}>
                {estimates.map((e) => (
                  <VehicleCard key={e.vehicle_type} option={e} active={selected?.vehicle_type === e.vehicle_type} hours={minHours ? Math.max(trip.hours, minHours) : 0} onPress={() => setSelected(e)} />
                ))}
              </View>
            )}
            {cancelPolicy ? <Text style={styles.policy} testID="cancellation-policy">{cancelPolicy}</Text> : null}

            {selected && surcharge && (
              <RideOptions value={options} onChange={setOptions} surcharge={surcharge} basePrice={selected.price} cardEnabled={cardEnabled} budget={budget} walletBalance={walletBalance} showSchedule={false} showBusiness={false} />
            )}

            <Pressable testID="confirm-ride-button" disabled={!selected || confirming} onPress={orderNow}
              style={({ pressed }) => [styles.confirmBtn, (!selected || confirming) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}>
              {confirming ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.confirmText} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>
                  {options.scheduledAt ? t("schedule") : t("book")} {selected ? `• ${money(Math.max(Math.max(selected.price + (options.surchargeEnabled && surcharge ? surcharge.amount : 0) - (options.promoCode ? options.discount : 0), 0) - (options.useWallet && !options.business ? walletBalance : 0), 0))}` : ""}
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

      <SheetModal visible={!!saveFav} onClose={() => setSaveFav(null)} title="Enregistrer l'adresse" subtitle={saveFav?.address} testID="save-favorite"
        footer={<Pressable testID="fav-submit" onPress={saveFavorite} style={styles.confirmBtn}><Text style={styles.confirmText}>Enregistrer</Text></Pressable>}>
        <View style={{ flexDirection: "row", gap: theme.spacing.sm, flexWrap: "wrap" }}>
          {["Maison", "Travail", "Autre"].map((l) => (
            <Pressable key={l} testID={`fav-label-${l}`} onPress={() => setFavLabel(l)} style={[styles.locChip, { boxShadow: "none", backgroundColor: favLabel === l ? theme.color.brand : theme.color.surfaceSecondary }]}>
              <Icon name={l === "Maison" ? "home" : l === "Travail" ? "briefcase" : "star"} size={16} color={favLabel === l ? "#fff" : theme.color.onSurface} />
              <Text style={[styles.locChipText, favLabel === l && { color: "#fff" }]}>{l}</Text>
            </Pressable>
          ))}
        </View>
        {favLabel === "Autre" && <TextInput testID="fav-custom" value={favCustom} onChangeText={setFavCustom} placeholder="Nom (ex. Salle de sport)" placeholderTextColor={theme.color.onSurfaceTertiary} style={[styles.searchWrap, { marginTop: theme.spacing.md, color: theme.color.onSurface, fontSize: 15 }]} />}
        <Text style={[styles.placeAddr, { marginTop: theme.spacing.md }]}>Vos favoris apparaissent en tête de liste pour commander en deux touches.</Text>
      </SheetModal>

      <SheetModal visible={stopPickerOpen} onClose={() => setStopPickerOpen(false)} title="Ajouter un arrêt" subtitle="2 min offertes par arrêt, puis 1 €/min" testID="stop-picker">
        <View style={styles.searchWrap}>
          {stopSearching ? <ActivityIndicator size="small" color={theme.color.onSurfaceTertiary} /> : <Icon name="magnify" size={20} color={theme.color.onSurfaceTertiary} />}
          <TextInput testID="stop-search" value={stopQuery} onChangeText={setStopQuery} placeholder="Adresse de l'arrêt" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.searchInput} autoFocus />
        </View>
        {[...favorites, ...POPULAR_PLACES].filter((p) => !stopQuery.trim() || p.name.toLowerCase().includes(stopQuery.toLowerCase())).slice(0, stopQuery.trim() ? 0 : 4).concat(stopResults as any).map((p: any) => (
          <Pressable key={p.id} testID={`stop-place-${p.id}`} onPress={() => { setStops((s) => [...s, p]); setStopPickerOpen(false); }} style={styles.placeRow}>
            <View style={styles.placeIcon}><Icon name={(p as any).icon || "map-marker-outline"} size={20} color={theme.color.onSurface} /></View>
            <View style={{ flex: 1 }}><Text style={styles.placeName}>{p.name}</Text><Text style={styles.placeAddr} numberOfLines={1}>{p.address}</Text></View>
          </Pressable>
        ))}
      </SheetModal>

      {!wizardDone && (
        <BookingWizard
          hasBusinessAccount={!!(budget && budget.active)}
          companyName={budget?.company}
          initialBusiness={options.business}
          initialSchedule={options.scheduledAt}
          onDone={onWizardDone}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.surface },
  topBar: { position: "absolute", left: theme.spacing.lg, right: theme.spacing.lg, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  locChip: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surface, paddingHorizontal: theme.spacing.md, height: 40, borderRadius: theme.radius.pill, boxShadow: "0 2px 8px rgba(0,0,0,0.1)", maxWidth: "75%" },
  locChipText: { color: theme.color.onSurface, fontWeight: "600", fontSize: 13, flexShrink: 1 },
  cartChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.color.brand, paddingHorizontal: theme.spacing.md, height: 40, borderRadius: theme.radius.pill, boxShadow: "0 2px 8px rgba(0,0,0,0.15)" },
  cartChipText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  activeBanner: { position: "absolute", left: theme.spacing.lg, right: theme.spacing.lg, backgroundColor: theme.color.success, flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.md, borderRadius: theme.radius.md },
  activeBannerText: { color: "#fff", fontWeight: "700", flex: 1 },
  sheetContent: { paddingHorizontal: theme.spacing.xl, width: "100%", maxWidth: 640, alignSelf: "center" },
  summaryBar: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, paddingHorizontal: theme.spacing.md, height: 40, marginTop: theme.spacing.sm, marginBottom: theme.spacing.sm },
  summaryChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  summaryText: { fontSize: 12, fontWeight: "700", color: theme.color.onSurface },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 22, fontWeight: "800", color: theme.color.onSurface, marginTop: theme.spacing.sm, marginBottom: theme.spacing.md },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 52, marginBottom: theme.spacing.md },
  searchInput: { flex: 1, fontSize: 16, color: theme.color.onSurface, height: "100%" },
  gpsRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: theme.spacing.sm, marginBottom: theme.spacing.sm },
  placeRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, paddingVertical: theme.spacing.md, borderBottomWidth: 1, borderBottomColor: theme.color.divider },
  placeIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  placeName: { fontSize: 15, fontWeight: "600", color: theme.color.onSurface },
  placeAddr: { fontSize: 13, color: theme.color.onSurfaceTertiary, marginTop: 2 },
  trip: { flexDirection: "row", gap: theme.spacing.md, backgroundColor: theme.color.surfaceSecondary, padding: theme.spacing.lg, borderRadius: theme.radius.md, marginTop: theme.spacing.sm, alignItems: "center" },
  tripLabel: { fontSize: 11, color: theme.color.onSurfaceTertiary, fontWeight: "600", textTransform: "uppercase" },
  tripAddr: { fontSize: 15, color: theme.color.onSurface, fontWeight: "600", marginTop: 2 },
  tripDivider: { height: 1, backgroundColor: theme.color.border, marginVertical: theme.spacing.sm },
  stopRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.md, height: 48, marginTop: theme.spacing.sm },
  stopText: { flex: 1, fontSize: 14, color: theme.color.onSurface, fontWeight: "600" },
  addStopBtn: { flexDirection: "row", gap: theme.spacing.sm, alignItems: "center", justifyContent: "center", height: 46, borderRadius: theme.radius.pill, borderWidth: 1.5, borderColor: theme.color.borderStrong, borderStyle: "dashed", marginTop: theme.spacing.sm },
  fixedRoute: { fontSize: 12, fontWeight: "700", color: theme.color.success, marginBottom: theme.spacing.sm },
  policy: { fontSize: 11, color: theme.color.onSurfaceTertiary, marginTop: theme.spacing.md, lineHeight: 15 },
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

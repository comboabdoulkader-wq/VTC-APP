import { Platform, Linking, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";

const API = process.env.EXPO_PUBLIC_BACKEND_URL;

/** Multipart upload that works on both web (Blob) and native ({uri,name,type}). */
export async function uploadDocument(token: string | null, asset: { uri: string; fileName?: string | null; mimeType?: string | null }, fields: Record<string, string>) {
  const form = new FormData();
  const name = asset.fileName || `doc-${Date.now()}.jpg`;
  const type = asset.mimeType || "image/jpeg";
  if (Platform.OS === "web") {
    const blob = await (await fetch(asset.uri)).blob();
    form.append("file", blob, name);
  } else {
    form.append("file", { uri: asset.uri, name, type } as any);
  }
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  const res = await fetch(`${API}/api/documents/upload`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(json.detail || `Erreur ${res.status}`);
  return json;
}

/** Contextual permission flow for camera / gallery. Returns the picked asset or null. */
export async function pickImage(source: "camera" | "library") {
  const perm = source === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    if (!perm.canAskAgain) {
      Alert.alert("Accès refusé", source === "camera" ? "Autorisez la caméra dans les réglages pour prendre votre selfie." : "Autorisez l'accès aux photos dans les réglages.", [
        { text: "Annuler", style: "cancel" }, { text: "Ouvrir les réglages", onPress: () => Linking.openSettings() },
      ]);
    }
    return null;
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, allowsEditing: false };
  const res = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets?.length) return null;
  return res.assets[0];
}

export const fileUrl = (path: string, token: string | null) => `${API}/api/files/${path}?token=${token}`;

// ---------- Navigation (Waze / Google Maps) ----------
export type NavApp = "waze" | "gmaps";
const NAV_KEY = "vtc_nav_app";
export const getNavApp = async (): Promise<NavApp | null> => (await AsyncStorage.getItem(NAV_KEY)) as NavApp | null;
export const setNavApp = (app: NavApp) => AsyncStorage.setItem(NAV_KEY, app);

/** Opens turn-by-turn navigation to a point. Falls back Waze → Google Maps → store hint. */
export async function openNavigation(app: NavApp, lat: number, lng: number, label?: string) {
  const gmapsWeb = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  const wazeWeb = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
  if (Platform.OS === "web") { Linking.openURL(app === "waze" ? wazeWeb : gmapsWeb); return; }
  const tryOpen = async (url: string) => { try { if (await Linking.canOpenURL(url)) { await Linking.openURL(url); return true; } } catch {} return false; };
  if (app === "waze") {
    if (await tryOpen(`waze://?ll=${lat},${lng}&navigate=yes`)) return;
    Alert.alert("Waze non installé", "Ouverture avec Google Maps.");
  }
  if (await tryOpen(Platform.OS === "ios" ? `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving` : `google.navigation:q=${lat},${lng}`)) return;
  if (await tryOpen(gmapsWeb)) return;
  Alert.alert("Aucune application de navigation", "Installez Waze ou Google Maps pour lancer la navigation.");
}

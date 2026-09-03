import React from "react";
import { View, StyleSheet, Text } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";

export type LatLng = { latitude: number; longitude: number };
export type MapMarker = { id: string; coordinate: LatLng; type: "pickup" | "dropoff" | "driver" };

type Props = {
  region: { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
  markers?: MapMarker[];
  polyline?: LatLng[];
  onRegionChange?: (r: any) => void;
};

const markerColor = (t: MapMarker["type"]) => {
  if (t === "pickup") return theme.color.success;
  if (t === "dropoff") return theme.color.error;
  return theme.color.onSurface;
};
const markerIcon = (t: MapMarker["type"]) => (t === "driver" ? "car" : t === "pickup" ? "circle" : "map-marker");

export default function MapCanvas({ markers = [] }: Props) {
  return (
    <View style={styles.webMap} testID="map-canvas-web">
      <View style={styles.grid} />
      {/* Fake streets */}
      <View style={[styles.street, { top: "20%", left: 0, right: 0, height: 2 }]} />
      <View style={[styles.street, { top: "50%", left: 0, right: 0, height: 3 }]} />
      <View style={[styles.street, { top: "75%", left: 0, right: 0, height: 2 }]} />
      <View style={[styles.streetV, { left: "25%", top: 0, bottom: 0, width: 2 }]} />
      <View style={[styles.streetV, { left: "60%", top: 0, bottom: 0, width: 3 }]} />
      {markers.map((m, i) => (
        <View
          key={m.id}
          style={[
            styles.webMarker,
            {
              top: `${30 + i * 20}%`,
              left: `${35 + i * 15}%`,
              backgroundColor: markerColor(m.type),
            } as any,
          ]}
        >
          <Icon name={markerIcon(m.type) as any} size={16} color="#fff" />
        </View>
      ))}
      <View style={[styles.webCenter, { pointerEvents: "none" }]}>
        <Text style={styles.webLabel}>Aperçu carte</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  webMap: { flex: 1, backgroundColor: "#E8ECEF", overflow: "hidden" },
  grid: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "#DDE3E7", opacity: 0.5 },
  street: { position: "absolute", backgroundColor: "#FFFFFF" },
  streetV: { position: "absolute", backgroundColor: "#FFFFFF" },
  webCenter: { position: "absolute", top: 8, left: 0, right: 0, alignItems: "center" },
  webLabel: { color: theme.color.onSurfaceTertiary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  webMarker: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
  },
});

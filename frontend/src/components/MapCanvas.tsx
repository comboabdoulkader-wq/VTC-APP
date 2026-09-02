import React from "react";
import { StyleSheet } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "react-native-maps";

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

export default function MapCanvas({ region, markers = [], polyline, onRegionChange }: Props) {
  return (
    <MapView
      testID="map-canvas-native"
      provider={PROVIDER_DEFAULT}
      style={StyleSheet.absoluteFill}
      initialRegion={region}
      showsUserLocation={false}
      showsCompass={false}
      onRegionChangeComplete={onRegionChange}
    >
      {markers.map((m) => (
        <Marker key={m.id} coordinate={m.coordinate} pinColor={markerColor(m.type)} />
      ))}
      {polyline && polyline.length > 1 && (
        <Polyline coordinates={polyline} strokeColor={theme.color.onSurface} strokeWidth={4} />
      )}
    </MapView>
  );
}

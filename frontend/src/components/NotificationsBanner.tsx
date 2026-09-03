import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, Vibration } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { apiFetch, useAuth } from "@/src/context/auth";

export type Notif = { id: string; type: string; title: string; body: string; ride_id?: string | null; read: boolean; created_at: string };

const ICONS: Record<string, string> = {
  arriving: "car-clock", accepted: "account-check", started: "car-arrow-right", completed: "flag-checkered",
  cancelled: "close-circle", assigned: "account-arrow-right", paid: "credit-card-check",
};

/**
 * Polls unread notifications and shows them as a top banner with haptics/vibration.
 * The "arriving" alert (driver < 2 min) is emphasised. SMS gateway lives server-side.
 */
export default function NotificationsBanner({ role }: { role: "passenger" | "driver" }) {
  const { token } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<Notif | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  const poll = useCallback(async () => {
    if (!token) return;
    try {
      const list = await apiFetch<Notif[]>("/notifications?unread_only=true", {}, token);
      if (!primed.current) {
        // First load: mark existing as seen so we only alert on new ones
        list.forEach((n) => seen.current.add(n.id));
        primed.current = true;
        return;
      }
      const fresh = list.filter((n) => !seen.current.has(n.id));
      if (fresh.length) {
        fresh.forEach((n) => seen.current.add(n.id));
        const n = fresh[0];
        setCurrent(n);
        if (Platform.OS !== "web") {
          if (n.type === "arriving") { Vibration.vibrate([0, 400, 200, 400]); }
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
      }
    } catch {}
  }, [token]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [poll]);

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setCurrent(null), current.type === "arriving" ? 15000 : 7000);
    return () => clearTimeout(t);
  }, [current]);

  const dismiss = async () => {
    if (!current) return;
    const id = current.id;
    setCurrent(null);
    apiFetch(`/notifications/${id}/read`, { method: "POST" }, token).catch(() => {});
  };

  const open = () => {
    const rideId = current?.ride_id;
    dismiss();
    if (rideId && role === "passenger") router.push(`/(passenger)/ride/${rideId}`);
  };

  if (!current) return null;
  const arriving = current.type === "arriving";
  return (
    <View style={[styles.wrap, { top: insets.top + 8, pointerEvents: "box-none" }]}>
      <Pressable testID="notification-banner" onPress={open} style={[styles.banner, arriving && styles.bannerArriving]}>
        <View style={[styles.iconWrap, arriving && { backgroundColor: "rgba(255,255,255,0.2)" }]}>
          <Icon name={(ICONS[current.type] || "bell") as any} size={22} color={arriving ? "#fff" : theme.color.onSurface} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, arriving && { color: "#fff" }]}>{current.title}</Text>
          <Text style={[styles.body, arriving && { color: "rgba(255,255,255,0.85)" }]} numberOfLines={2}>{current.body}</Text>
        </View>
        <Pressable testID="notification-dismiss" onPress={dismiss} hitSlop={10}>
          <Icon name="close" size={20} color={arriving ? "#fff" : theme.color.onSurfaceTertiary} />
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: theme.spacing.lg, right: theme.spacing.lg, zIndex: 100 },
  banner: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md, backgroundColor: theme.color.surface, padding: theme.spacing.md, borderRadius: theme.radius.lg, boxShadow: "0 4px 14px rgba(0,0,0,0.18)", borderWidth: 1, borderColor: theme.color.border },
  bannerArriving: { backgroundColor: theme.color.success, borderColor: theme.color.success },
  iconWrap: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, fontWeight: "800", color: theme.color.onSurface },
  body: { fontSize: 13, color: theme.color.onSurfaceSecondary, marginTop: 2 },
});

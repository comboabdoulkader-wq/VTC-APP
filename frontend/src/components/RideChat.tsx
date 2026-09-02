import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import SheetModal from "@/src/components/ui/SheetModal";
import { apiFetch, useAuth } from "@/src/context/auth";
import { fmtTime } from "@/src/utils/format";

type Msg = { id: string; sender_id: string; sender_name: string; text: string; created_at: string };

/** In-ride chat passenger ↔ driver (no phone numbers shared). Polls every 3 s while open. */
export default function RideChat({ rideId, visible, onClose, title, canSend }: { rideId: string; visible: boolean; onClose: () => void; title: string; canSend: boolean }) {
  const { token, user } = useAuth();
  const insets = useSafeAreaInsets();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scroll = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    try { setMsgs(await apiFetch<Msg[]>(`/rides/${rideId}/messages`, {}, token)); } catch {}
  }, [rideId, token]);

  useEffect(() => {
    if (!visible) return;
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [visible, load]);

  useEffect(() => { setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100); }, [msgs.length]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setSending(true);
    try { const m = await apiFetch<Msg>(`/rides/${rideId}/messages`, { method: "POST", body: JSON.stringify({ text: t }) }, token); setMsgs((l) => [...l, m]); setText(""); }
    catch {} finally { setSending(false); }
  };

  const QUICK = ["J'arrive dans 2 min", "Je suis sur place", "Où êtes-vous exactement ?", "Merci !"];

  return (
    <SheetModal visible={visible} onClose={onClose} title={title} subtitle="Messagerie sécurisée · numéros non partagés" testID="ride-chat"
      footer={canSend ? (
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 8 }}>
            {QUICK.map((q) => <Pressable key={q} testID="chat-quick" onPress={() => setText(q)} style={styles.quick}><Text style={styles.quickText}>{q}</Text></Pressable>)}
          </ScrollView>
          <View style={styles.inputRow}>
            <TextInput testID="chat-input" value={text} onChangeText={setText} placeholder="Votre message…" placeholderTextColor={theme.color.onSurfaceTertiary} style={styles.input} onSubmitEditing={send} returnKeyType="send" />
            <Pressable testID="chat-send" onPress={send} disabled={sending || !text.trim()} style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.5 }]}>
              {sending ? <ActivityIndicator color="#fff" size="small" /> : <Icon name="send" size={20} color="#fff" />}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : <Text style={[styles.meta, { textAlign: "center", paddingBottom: insets.bottom }]}>La messagerie est fermée (course terminée).</Text>}>
      <ScrollView ref={scroll} style={{ minHeight: 200 }}>
        {msgs.length === 0 ? <Text style={styles.meta}>Aucun message. Dites bonjour 👋</Text> : msgs.map((m) => {
          const mine = m.sender_id === user?.id;
          return (
            <View key={m.id} testID={`chat-msg-${m.id}`} style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
              {!mine && <Text style={styles.sender}>{m.sender_name}</Text>}
              <Text style={[styles.text, mine && { color: "#fff" }]}>{m.text}</Text>
              <Text style={[styles.time, mine && { color: "rgba(255,255,255,0.7)" }]}>{fmtTime(m.created_at)}</Text>
            </View>
          );
        })}
      </ScrollView>
    </SheetModal>
  );
}

/** Small chat launcher button with unread badge (polls every 5 s). */
export function ChatButton({ rideId, onPress, label = "Message" }: { rideId: string; onPress: () => void; label?: string }) {
  const { token } = useAuth();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    const poll = () => apiFetch<{ unread: number }>(`/rides/${rideId}/messages/unread`, {}, token).then((r) => setUnread(r.unread)).catch(() => {});
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [rideId, token]);
  return (
    <Pressable testID="open-chat" onPress={onPress} style={styles.chatBtn}>
      <Icon name="message-text-outline" size={18} color={theme.color.onSurface} />
      <Text style={styles.chatBtnText}>{label}</Text>
      {unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{unread}</Text></View>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bubble: { maxWidth: "80%", padding: theme.spacing.md, borderRadius: 16, marginBottom: theme.spacing.sm },
  mine: { alignSelf: "flex-end", backgroundColor: theme.color.brand, borderBottomRightRadius: 4 },
  theirs: { alignSelf: "flex-start", backgroundColor: theme.color.surfaceSecondary, borderBottomLeftRadius: 4 },
  sender: { fontSize: 11, fontWeight: "700", color: theme.color.onSurfaceSecondary, marginBottom: 2 },
  text: { fontSize: 15, color: theme.color.onSurface },
  time: { fontSize: 10, color: theme.color.onSurfaceTertiary, marginTop: 4, alignSelf: "flex-end" },
  meta: { fontSize: 13, color: theme.color.onSurfaceTertiary, paddingVertical: theme.spacing.md },
  quick: { paddingHorizontal: theme.spacing.md, height: 32, borderRadius: theme.radius.pill, backgroundColor: theme.color.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  quickText: { fontSize: 12, fontWeight: "600", color: theme.color.onSurface },
  inputRow: { flexDirection: "row", gap: theme.spacing.sm, alignItems: "center" },
  input: { flex: 1, backgroundColor: theme.color.surfaceSecondary, borderRadius: theme.radius.pill, paddingHorizontal: theme.spacing.lg, height: 46, fontSize: 15, color: theme.color.onSurface },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: theme.color.brand, alignItems: "center", justifyContent: "center" },
  chatBtn: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", height: 44, borderRadius: theme.radius.pill, borderWidth: 1.5, borderColor: theme.color.borderStrong, marginBottom: theme.spacing.md, position: "relative" },
  chatBtnText: { fontWeight: "700", color: theme.color.onSurface, fontSize: 14 },
  badge: { position: "absolute", right: 12, top: 10, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: theme.color.error, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "800" },
});

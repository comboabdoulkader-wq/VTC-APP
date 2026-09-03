import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";

import { useAuth, homeFor } from "@/src/context/auth";
import { useGoogleCallback } from "@/src/hooks/useGoogleAuth";
import { theme } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useGoogleCallback();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/(auth)/welcome");
    else router.replace(homeFor(user.role) as any);
  }, [user, loading, router]);

  return (
    <View style={styles.container} testID="root-loading">
      <ActivityIndicator size="large" color={theme.color.onSurface} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.color.surface, alignItems: "center", justifyContent: "center" },
});

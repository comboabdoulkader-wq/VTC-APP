import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { useRouter } from "expo-router";

import { theme } from "@/src/theme";
import { homeFor } from "@/src/context/auth";
import { useAppleAuth } from "@/src/hooks/useAppleAuth";

/** Native "Sign in with Apple" button. Renders only on iOS devices where Apple auth is available. */
export default function AppleButton({ role = "passenger" }: { role?: "passenger" | "driver" }) {
  const [available, setAvailable] = useState(false);
  const { signIn, error } = useAppleAuth();
  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    if (Platform.OS === "ios") {
      AppleAuthentication.isAvailableAsync().then((v) => mounted && setAvailable(v)).catch(() => {});
    }
    return () => { mounted = false; };
  }, []);

  if (!available) return null;

  return (
    <View style={styles.wrap} testID="apple-signin">
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={28}
        style={styles.btn}
        onPress={async () => {
          const u = await signIn(role);
          if (u) router.replace(homeFor(u.role) as any);
        }}
      />
      {error ? <Text style={styles.error} testID="apple-error">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: theme.spacing.md },
  btn: { width: "100%", height: 56 },
  error: { color: theme.color.error, fontSize: 13, marginTop: theme.spacing.sm, textAlign: "center" },
});

import { Tabs } from "expo-router";
import { View } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import NotificationsBanner from "@/src/components/NotificationsBanner";

export default function DriverLayout() {
  const { t } = useI18n();
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.color.onSurface,
          tabBarInactiveTintColor: theme.color.onSurfaceTertiary,
          tabBarStyle: { backgroundColor: theme.color.surface, borderTopColor: theme.color.border },
          tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
        }}
      >
        <Tabs.Screen name="index" options={{ title: t("tab_home"), tabBarIcon: ({ color, size }) => <Icon name="steering" size={size} color={color} /> }} />
        <Tabs.Screen name="private" options={{ title: t("tab_private"), tabBarIcon: ({ color, size }) => <Icon name="notebook-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="team" options={{ title: t("tab_team"), tabBarIcon: ({ color, size }) => <Icon name="account-group-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="documents" options={{ title: t("tab_documents"), tabBarIcon: ({ color, size }) => <Icon name="file-check-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="earnings" options={{ title: t("tab_earnings"), tabBarIcon: ({ color, size }) => <Icon name="wallet-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="profile" options={{ title: t("tab_profile"), tabBarIcon: ({ color, size }) => <Icon name="account" size={size} color={color} /> }} />
      </Tabs>
      <NotificationsBanner role="driver" />
    </View>
  );
}

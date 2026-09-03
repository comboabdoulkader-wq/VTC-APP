import { Tabs } from "expo-router";
import { View } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useI18n } from "@/src/i18n";
import NotificationsBanner from "@/src/components/NotificationsBanner";

export default function PassengerLayout() {
  const { t } = useI18n();
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: theme.color.onSurface,
          tabBarInactiveTintColor: theme.color.onSurfaceTertiary,
          tabBarStyle: { backgroundColor: theme.color.surface, borderTopColor: theme.color.border },
          tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        }}
      >
        <Tabs.Screen name="index" options={{ title: t("tab_home"), tabBarIcon: ({ color, size }) => <Icon name="map-search" size={size} color={color} /> }} />
        <Tabs.Screen name="rides" options={{ title: t("tab_rides"), tabBarIcon: ({ color, size }) => <Icon name="car-multiple" size={size} color={color} /> }} />
        <Tabs.Screen name="profile" options={{ title: t("tab_profile"), tabBarIcon: ({ color, size }) => <Icon name="account" size={size} color={color} /> }} />
        <Tabs.Screen name="ride/[id]" options={{ href: null }} />
        <Tabs.Screen name="payment-result" options={{ href: null, tabBarStyle: { display: "none" } }} />
      </Tabs>
      <NotificationsBanner role="passenger" />
    </View>
  );
}

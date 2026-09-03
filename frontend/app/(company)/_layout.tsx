import { Tabs } from "expo-router";
import { View } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import { useI18n } from "@/src/i18n";

export default function CompanyLayout() {
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
        <Tabs.Screen name="index" options={{ title: t("tab_dashboard"), tabBarButtonTestID: "tab-company-dashboard", tabBarIcon: ({ color, size }) => <Icon name="view-dashboard-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="bookings" options={{ title: "Clients", tabBarButtonTestID: "tab-clients", tabBarIcon: ({ color, size }) => <Icon name="bell-ring-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="employees" options={{ title: t("tab_employees"), tabBarButtonTestID: "tab-employees", tabBarIcon: ({ color, size }) => <Icon name="account-group-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="profile" options={{ title: t("company"), tabBarButtonTestID: "tab-company", tabBarIcon: ({ color, size }) => <Icon name="office-building-outline" size={size} color={color} /> }} />
      </Tabs>
    </View>
  );
}

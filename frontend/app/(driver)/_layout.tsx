import { Tabs } from "expo-router";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";

export default function DriverLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.color.onSurface,
        tabBarInactiveTintColor: theme.color.onSurfaceTertiary,
        tabBarStyle: { backgroundColor: theme.color.surface, borderTopColor: theme.color.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Accueil", tabBarIcon: ({ color, size }) => <Icon name="steering" size={size} color={color} /> }} />
      <Tabs.Screen name="earnings" options={{ title: "Gains", tabBarIcon: ({ color, size }) => <Icon name="wallet-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profil", tabBarIcon: ({ color, size }) => <Icon name="account" size={size} color={color} /> }} />
    </Tabs>
  );
}

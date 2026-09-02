import { Tabs } from "expo-router";
import { View } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";
import NotificationsBanner from "@/src/components/NotificationsBanner";

export default function DriverLayout() {
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
        <Tabs.Screen name="index" options={{ title: "Accueil", tabBarIcon: ({ color, size }) => <Icon name="steering" size={size} color={color} /> }} />
        <Tabs.Screen name="private" options={{ title: "Privées", tabBarIcon: ({ color, size }) => <Icon name="notebook-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="team" options={{ title: "Équipe", tabBarIcon: ({ color, size }) => <Icon name="account-group-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="documents" options={{ title: "Documents", tabBarIcon: ({ color, size }) => <Icon name="file-check-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="earnings" options={{ title: "Gains", tabBarIcon: ({ color, size }) => <Icon name="wallet-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="profile" options={{ title: "Profil", tabBarIcon: ({ color, size }) => <Icon name="account" size={size} color={color} /> }} />
      </Tabs>
      <NotificationsBanner role="driver" />
    </View>
  );
}

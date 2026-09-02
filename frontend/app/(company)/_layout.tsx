import { Tabs } from "expo-router";
import { View } from "react-native";
import Icon from "@react-native-vector-icons/material-design-icons";

import { theme } from "@/src/theme";

export default function CompanyLayout() {
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
        <Tabs.Screen name="index" options={{ title: "Tableau de bord", tabBarIcon: ({ color, size }) => <Icon name="view-dashboard-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="employees" options={{ title: "Employés", tabBarIcon: ({ color, size }) => <Icon name="account-group-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="profile" options={{ title: "Entreprise", tabBarIcon: ({ color, size }) => <Icon name="office-building-outline" size={size} color={color} /> }} />
      </Tabs>
    </View>
  );
}

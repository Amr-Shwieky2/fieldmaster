import type { ComponentType } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTranslations } from "use-intl";
import { useAccess } from "../lib/access-context";
import { colors, fonts } from "../lib/theme";
import { HomeScreen } from "../screens/HomeScreen";
import { ManagerHomeScreen } from "../screens/ManagerHomeScreen";
import { NotificationsScreen } from "../screens/NotificationsScreen";
import type { ManagerTabParamList } from "./types";

const Tab = createBottomTabNavigator<ManagerTabParamList>();

type IconName = keyof typeof Ionicons.glyphMap;

function tabIcon(name: IconName) {
  return function TabIcon({ color, size }: { color: string; size: number }) {
    return <Ionicons name={name} color={color} size={size} />;
  };
}

/**
 * The root of a member who manages (mobile manager mode), decided by their
 * permissions: «الإدارة» (counters and actions), «دوامي» only for a member
 * who clocks in themselves (the worker home they already know), and
 * «الإشعارات».
 */
export function ManagerTabs() {
  const t = useTranslations("tabs");
  const { hasWorkerHome } = useAccess();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 13 },
      }}
    >
      <Tab.Screen name="ManageTab" component={ManagerHomeScreen} options={{ title: t("manage"), tabBarIcon: tabIcon("briefcase-outline") }} />
      {hasWorkerHome ? (
        <Tab.Screen
          name="MyWorkTab"
          // The worker home is a stack screen; inside the tabs it only navigates to stack screens, which the root stack has.
          component={HomeScreen as unknown as ComponentType}
          options={{ title: t("myWork"), tabBarIcon: tabIcon("time-outline") }}
        />
      ) : null}
      <Tab.Screen
        name="NotificationsTab"
        component={NotificationsScreen as unknown as ComponentType}
        options={{ title: t("notifications"), tabBarIcon: tabIcon("notifications-outline") }}
      />
    </Tab.Navigator>
  );
}

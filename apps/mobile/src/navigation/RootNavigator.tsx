import { DefaultTheme, NavigationContainer, type Theme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../lib/auth-context";
import { isLayoutRTL } from "../lib/rtl";
import { colors, fonts } from "../lib/theme";
import { LoadingView } from "../components/StateViews";
import { LoginScreen } from "../screens/LoginScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { ClockInScreen } from "../screens/ClockInScreen";
import { ClockOutScreen } from "../screens/ClockOutScreen";
import { HistoryScreen } from "../screens/HistoryScreen";
import { OfflineQueueScreen } from "../screens/OfflineQueueScreen";
import { ShiftDetailsScreen } from "../screens/ShiftDetailsScreen";
import { EmergencyScreen } from "../screens/EmergencyScreen";
import { AccountStateScreen } from "../screens/AccountStateScreen";
import { HistoryDetailScreen } from "../screens/HistoryDetailScreen";
import { NotificationPreferencesScreen } from "../screens/NotificationPreferencesScreen";
import { NotificationsScreen } from "../screens/NotificationsScreen";
import { SalaryScreen } from "../screens/SalaryScreen";
import { SupervisorScreen } from "../screens/SupervisorScreen";
import { flushPendingLink, navigationRef } from "../lib/linking";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

// Navigation chrome in the Arabic font (one family per weight, no fontWeight).
const theme: Theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.background, primary: colors.primary, text: colors.text, card: colors.card, border: colors.border },
  fonts: {
    regular: { fontFamily: fonts.regular, fontWeight: "normal" },
    medium: { fontFamily: fonts.semibold, fontWeight: "normal" },
    bold: { fontFamily: fonts.bold, fontWeight: "normal" },
    heavy: { fontFamily: fonts.bold, fontWeight: "normal" },
  },
};

export function RootNavigator() {
  const { isAuthenticated, isLoading, accountState } = useAuth();

  if (isLoading) return <LoadingView />;

  // React Navigation reads RTL from I18nManager, which react-native-web never sets: pass it explicitly.
  // The ref and flushPendingLink open a tapped notification's screen once the signed-in screens exist (linking.ts).
  return (
    <NavigationContainer ref={navigationRef} onReady={flushPendingLink} onStateChange={flushPendingLink} theme={theme} direction={isLayoutRTL() ? "rtl" : "ltr"}>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        {accountState ? (
          // Pending approval, rejected, suspended or a revoked device key: nothing else is mounted.
          <Stack.Screen name="AccountState" component={AccountStateScreen} />
        ) : isAuthenticated ? (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="ClockIn" component={ClockInScreen} options={{ presentation: "modal" }} />
            <Stack.Screen name="ClockOut" component={ClockOutScreen} options={{ presentation: "modal" }} />
            <Stack.Screen name="History" component={HistoryScreen} />
            <Stack.Screen name="OfflineQueue" component={OfflineQueueScreen} />
            <Stack.Screen name="ShiftDetails" component={ShiftDetailsScreen} />
            <Stack.Screen name="Emergency" component={EmergencyScreen} />
            <Stack.Screen name="HistoryDetail" component={HistoryDetailScreen} />
            <Stack.Screen name="Salary" component={SalaryScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="NotificationPreferences" component={NotificationPreferencesScreen} />
            <Stack.Screen name="Supervisor" component={SupervisorScreen} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

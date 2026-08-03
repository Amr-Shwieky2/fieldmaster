import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../lib/auth-context";
import { colors } from "../lib/theme";
import { LoginScreen } from "../screens/LoginScreen";
import { HomeScreen } from "../screens/HomeScreen";
import { ClockInScreen } from "../screens/ClockInScreen";
import { ClockOutScreen } from "../screens/ClockOutScreen";
import { HistoryScreen } from "../screens/HistoryScreen";
import { OfflineQueueScreen } from "../screens/OfflineQueueScreen";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {isAuthenticated ? (
          <>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="ClockIn" component={ClockInScreen} options={{ presentation: "modal" }} />
            <Stack.Screen name="ClockOut" component={ClockOutScreen} options={{ presentation: "modal" }} />
            <Stack.Screen name="History" component={HistoryScreen} />
            <Stack.Screen name="OfflineQueue" component={OfflineQueueScreen} />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

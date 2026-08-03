import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/lib/auth-context";
import { OfflineSyncProvider } from "./src/lib/offline-sync-context";
import { RootNavigator } from "./src/navigation/RootNavigator";

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <OfflineSyncProvider>
          <RootNavigator />
          <StatusBar style="auto" />
        </OfflineSyncProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

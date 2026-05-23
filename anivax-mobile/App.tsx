import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/auth/AuthContext";
import LoginPhoneScreen from "@/screens/LoginPhoneScreen";
import OtpScreen from "@/screens/OtpScreen";
import HomeScreen from "@/screens/HomeScreen";
import QueueTicketScreen from "@/screens/QueueTicketScreen";
import DoseScheduleScreen from "@/screens/DoseScheduleScreen";
import ExposureIntakeScreen from "@/screens/ExposureIntakeScreen";
import ProfileScreen from "@/screens/ProfileScreen";
import DocumentsScreen from "@/screens/DocumentsScreen";
import type { RootStackParamList } from "@/navigation";

const Stack = createNativeStackNavigator<RootStackParamList>();

function Routes() {
  const { user, bootstrapping } = useAuth();
  if (bootstrapping) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color="#0F766E" />
      </View>
    );
  }
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: "#0F766E" },
        headerTintColor: "#fff",
        headerTitleStyle: { fontWeight: "700" },
      }}
    >
      {!user ? (
        <>
          <Stack.Screen
            name="LoginPhone"
            component={LoginPhoneScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Otp"
            component={OtpScreen}
            options={{ title: "Verify" }}
          />
        </>
      ) : (
        <>
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ title: "Anivax" }}
          />
          <Stack.Screen
            name="QueueTicket"
            component={QueueTicketScreen}
            options={{ title: "My Ticket" }}
          />
          <Stack.Screen
            name="DoseSchedule"
            component={DoseScheduleScreen}
            options={{ title: "Dose Schedule" }}
          />
          <Stack.Screen
            name="ExposureIntake"
            component={ExposureIntakeScreen}
            options={{ title: "Report Exposure" }}
          />
          <Stack.Screen
            name="Profile"
            component={ProfileScreen}
            options={{ title: "Profile" }}
          />
          <Stack.Screen
            name="Documents"
            component={DocumentsScreen}
            options={{ title: "Documents" }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <Routes />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
  },
});

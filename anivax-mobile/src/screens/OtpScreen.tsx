import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";

import { useAuth } from "@/auth/AuthContext";
import type { RootStackParamList } from "@/navigation";

export default function OtpScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Otp">>();
  const { verifyOtp } = useAuth();
  const phone = route.params.phone;
  const [otp, setOtp] = useState(route.params.devOtp ?? "");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (route.params.devOtp) setOtp(route.params.devOtp);
  }, [route.params.devOtp]);

  const handleVerify = async () => {
    if (submitting) return;
    if (otp.length !== 6) {
      Alert.alert("Invalid OTP", "OTP is 6 digits.");
      return;
    }
    setSubmitting(true);
    try {
      await verifyOtp(phone, otp);
      // Navigation handled by AuthProvider state change.
    } catch (err) {
      const message = err instanceof Error ? err.message : "Verification failed.";
      Alert.alert("Could not verify", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Enter OTP</Text>
      <Text style={styles.subtitle}>Sent to {phone}</Text>

      <TextInput
        value={otp}
        onChangeText={(s) => setOtp(s.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        placeholder="••••••"
        placeholderTextColor="#9CA3AF"
        style={styles.input}
        autoFocus
      />

      <TouchableOpacity
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={handleVerify}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Verify</Text>
        )}
      </TouchableOpacity>

      {route.params.devOtp ? (
        <Text style={styles.devHint}>
          Dev OTP delivered via stub provider: {route.params.devOtp}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, justifyContent: "center", backgroundColor: "#F8FAFC" },
  title: { fontSize: 28, fontWeight: "800", color: "#0F172A", textAlign: "center" },
  subtitle: { fontSize: 14, color: "#475569", textAlign: "center", marginTop: 4, marginBottom: 32 },
  input: {
    height: 60,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    fontSize: 28,
    color: "#0F172A",
    textAlign: "center",
    letterSpacing: 8,
    marginBottom: 24,
  },
  button: {
    height: 48,
    borderRadius: 10,
    backgroundColor: "#0F766E",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  devHint: { color: "#9CA3AF", fontSize: 11, marginTop: 16, textAlign: "center" },
});

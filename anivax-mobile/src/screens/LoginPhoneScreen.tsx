import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useAuth } from "@/auth/AuthContext";
import type { RootStackParamList } from "@/navigation";

export default function LoginPhoneScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { requestOtp } = useAuth();
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleNext = async () => {
    if (submitting) return;
    if (phone.replace(/\D/g, "").length < 10) {
      Alert.alert("Invalid phone", "Enter your full mobile number.");
      return;
    }
    setSubmitting(true);
    try {
      const { devOtp } = await requestOtp(phone);
      navigation.navigate("Otp", { phone, devOtp });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not send OTP. Try again.";
      Alert.alert("Could not send OTP", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Text style={styles.title}>Anivax</Text>
      <Text style={styles.subtitle}>Sign in with your mobile number</Text>

      <Text style={styles.label}>MOBILE NUMBER</Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder="+63 9XX XXX XXXX"
        placeholderTextColor="#9CA3AF"
        keyboardType="phone-pad"
        autoComplete="tel"
        style={styles.input}
      />
      <TouchableOpacity
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={handleNext}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Send OTP</Text>
        )}
      </TouchableOpacity>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Standard SMS rates may apply. The code is valid for 5 minutes.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, justifyContent: "center", backgroundColor: "#F8FAFC" },
  title: { fontSize: 32, fontWeight: "800", color: "#0F172A", textAlign: "center" },
  subtitle: { fontSize: 14, color: "#475569", textAlign: "center", marginTop: 4, marginBottom: 32 },
  label: { fontSize: 12, fontWeight: "700", color: "#0EA5E9", letterSpacing: 1 },
  input: {
    height: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    fontSize: 16,
    color: "#0F172A",
    marginTop: 6,
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
  footer: { marginTop: 32, alignItems: "center" },
  footerText: { color: "#64748B", fontSize: 12, textAlign: "center" },
});

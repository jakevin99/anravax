import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import client from "@/api/client";
import type { PatientProfile } from "@/api/types";

export default function ProfileScreen() {
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await client.get<{ data: PatientProfile }>("/patients/me");
        setProfile(res.data?.data ?? null);
      } catch (e) {
        Alert.alert(
          "Could not load profile",
          e instanceof Error ? e.message : "Unknown error",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = (key: keyof PatientProfile, value: string) => {
    setProfile((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!profile || saving) return;
    setSaving(true);
    try {
      await client.patch<{ data: PatientProfile }>("/patients/me", {
        firstName: profile.firstName,
        middleName: profile.middleName,
        lastName: profile.lastName,
        birthDate: profile.birthDate,
        sex: profile.sex,
        address: profile.address,
        bloodType: profile.bloodType,
      });
      Alert.alert("Saved", "Your profile has been updated.");
    } catch (e) {
      Alert.alert(
        "Could not save",
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading || !profile) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#0F766E" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>My profile</Text>

      <Field label="First name" value={profile.firstName} onChange={(v) => update("firstName", v)} />
      <Field
        label="Middle name"
        value={profile.middleName ?? ""}
        onChange={(v) => update("middleName", v)}
      />
      <Field label="Last name" value={profile.lastName} onChange={(v) => update("lastName", v)} />
      <Field label="Birth date" value={profile.birthDate} onChange={(v) => update("birthDate", v)} />
      <Field
        label="Sex"
        value={profile.sex}
        onChange={(v) => update("sex", v.toUpperCase().startsWith("M") ? "M" : "F")}
      />
      <Field
        label="Address"
        value={profile.address ?? ""}
        onChange={(v) => update("address", v)}
      />
      <Field
        label="Blood type"
        value={profile.bloodType ?? ""}
        onChange={(v) => update("bloodType", v)}
      />

      <TouchableOpacity
        style={[styles.button, saving && styles.buttonDisabled]}
        onPress={handleSave}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Save changes</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        style={styles.input}
        placeholderTextColor="#9CA3AF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "800", color: "#0F172A", marginBottom: 16 },
  field: { marginBottom: 14 },
  label: { fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 4, letterSpacing: 1 },
  input: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    fontSize: 14,
    color: "#0F172A",
  },
  button: {
    marginTop: 16,
    height: 48,
    borderRadius: 10,
    backgroundColor: "#0F766E",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});

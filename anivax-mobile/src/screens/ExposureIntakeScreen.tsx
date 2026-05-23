import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import client from "@/api/client";
import type { ExposureIntake } from "@/api/types";
import type { RootStackParamList } from "@/navigation";

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function ExposureIntakeScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [form, setForm] = useState<ExposureIntake>({
    chiefComplaint: "",
    dateOfIncidence: todayIso(),
    timeOfIncidence: "12:00",
    placeOfIncidence: "",
    siteOfInjury: "",
    animalType: "",
    washedInjury: false,
    animalVaccinated: false,
  });
  const [submitting, setSubmitting] = useState(false);

  const update = <K extends keyof ExposureIntake>(
    key: K,
    value: ExposureIntake[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await client.post("/patients/me/exposure-intake", form);
      Alert.alert(
        "Request received",
        "Clinic staff will confirm your appointment shortly.",
        [{ text: "OK", onPress: () => navigation.goBack() }],
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not submit.";
      Alert.alert("Submission failed", message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Report exposure</Text>
      <Text style={styles.subtitle}>
        We'll review your details and confirm a queue slot.
      </Text>

      <Field label="Chief complaint">
        <TextInput
          value={form.chiefComplaint}
          onChangeText={(s) => update("chiefComplaint", s)}
          style={styles.input}
          placeholder="What happened?"
          placeholderTextColor="#9CA3AF"
        />
      </Field>

      <Row>
        <Field label="Date" half>
          <TextInput
            value={form.dateOfIncidence}
            onChangeText={(s) => update("dateOfIncidence", s)}
            style={styles.input}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#9CA3AF"
          />
        </Field>
        <Field label="Time" half>
          <TextInput
            value={form.timeOfIncidence}
            onChangeText={(s) => update("timeOfIncidence", s)}
            style={styles.input}
            placeholder="HH:MM"
            placeholderTextColor="#9CA3AF"
          />
        </Field>
      </Row>

      <Field label="Place">
        <TextInput
          value={form.placeOfIncidence}
          onChangeText={(s) => update("placeOfIncidence", s)}
          style={styles.input}
          placeholder="Where did it happen?"
          placeholderTextColor="#9CA3AF"
        />
      </Field>

      <Field label="Site of injury">
        <TextInput
          value={form.siteOfInjury}
          onChangeText={(s) => update("siteOfInjury", s)}
          style={styles.input}
          placeholder="e.g. right hand, left calf"
          placeholderTextColor="#9CA3AF"
        />
      </Field>

      <Field label="Animal">
        <TextInput
          value={form.animalType}
          onChangeText={(s) => update("animalType", s)}
          style={styles.input}
          placeholder="Dog / cat / other"
          placeholderTextColor="#9CA3AF"
        />
      </Field>

      <Toggle
        label="Washed the injury immediately"
        value={form.washedInjury}
        onChange={(v) => update("washedInjury", v)}
      />
      <Toggle
        label="Animal is vaccinated"
        value={form.animalVaccinated}
        onChange={(v) => update("animalVaccinated", v)}
      />

      <TouchableOpacity
        style={[styles.button, submitting && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Submit for review</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({
  label,
  children,
  half,
}: {
  label: string;
  children: React.ReactNode;
  half?: boolean;
}) {
  return (
    <View style={[styles.field, half && styles.fieldHalf]}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: "800", color: "#0F172A" },
  subtitle: { fontSize: 13, color: "#64748B", marginTop: 4, marginBottom: 16 },
  row: { flexDirection: "row", gap: 12 },
  field: { marginBottom: 14 },
  fieldHalf: { flex: 1 },
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
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  toggleLabel: { fontSize: 14, color: "#0F172A" },
  button: {
    marginTop: 18,
    height: 48,
    borderRadius: 10,
    backgroundColor: "#0F766E",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";

import client from "@/api/client";
import type { DoseAdministration, DoseSchedule } from "@/api/types";

function statusColor(status: DoseAdministration["status"]): string {
  switch (status) {
    case "GIVEN":
      return "#16A34A";
    case "DUE":
      return "#D97706";
    case "OVERDUE":
      return "#BE123C";
    case "UPCOMING":
    default:
      return "#475569";
  }
}

export default function DoseScheduleScreen() {
  const [schedules, setSchedules] = useState<DoseSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await client.get<{ data: { items: DoseSchedule[] } }>(
          "/dose-schedules/me",
        );
        if (cancelled) return;
        setSchedules(res.data?.data?.items ?? []);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load doses.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#0F766E" />
      </View>
    );
  }

  if (!schedules.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No PEP schedule on file.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <FlatList
      data={schedules}
      keyExtractor={(s) => String(s.id)}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <View style={styles.scheduleCard}>
          <Text style={styles.scheduleTitle}>{item.regimenLabel}</Text>
          <Text style={styles.scheduleSub}>
            Day 0: {item.day0Date} · {item.status}
          </Text>
          {item.doses.map((d) => (
            <View key={d.id} style={styles.doseRow}>
              <View style={styles.doseLeft}>
                <Text style={styles.doseTitle}>Dose {d.doseNumber}</Text>
                <Text style={styles.doseSub}>
                  {d.givenAt ? `Given ${d.givenAt.slice(0, 10)}` : `Due ${d.dueDate}`}
                </Text>
              </View>
              <View
                style={[styles.badge, { backgroundColor: statusColor(d.status) }]}
              >
                <Text style={styles.badgeText}>{d.status}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  scheduleCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  scheduleTitle: { fontSize: 16, fontWeight: "800", color: "#0F172A" },
  scheduleSub: { fontSize: 12, color: "#64748B", marginTop: 2, marginBottom: 10 },
  doseRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  doseLeft: { flex: 1 },
  doseTitle: { fontSize: 15, fontWeight: "700", color: "#0F172A" },
  doseSub: { fontSize: 12, color: "#64748B", marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: "#fff", fontWeight: "800", fontSize: 11, letterSpacing: 1 },
  empty: { color: "#475569", fontSize: 16 },
  error: { color: "#BE123C", marginTop: 12 },
});

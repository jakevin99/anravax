import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import client from "@/api/client";
import { QUEUE_POLL_MS } from "@/config/env";
import type { QueueTicket } from "@/api/types";

export default function QueueTicketScreen() {
  const [ticket, setTicket] = useState<QueueTicket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const tick = async () => {
      try {
        const res = await client.get<{ data: QueueTicket | null }>(
          "/queue-tickets/me",
        );
        if (cancelled) return;
        setTicket(res.data?.data ?? null);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not load ticket.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void tick();
    timer = setInterval(tick, QUEUE_POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#0F766E" />
      </View>
    );
  }

  if (!ticket) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No active ticket today.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.label}>YOUR TOKEN</Text>
      <Text style={styles.token}>{ticket.tokenCode}</Text>

      <View style={styles.statusBadge}>
        <Text style={styles.statusText}>{ticket.status}</Text>
      </View>

      {ticket.status === "WAITING" ? (
        <>
          <Text style={styles.bigNumber}>{ticket.peopleAhead}</Text>
          <Text style={styles.bigLabel}>people ahead</Text>
          <Text style={styles.eta}>
            ETA ~ {ticket.etaMinutes ?? "—"} min
          </Text>
        </>
      ) : ticket.status === "CALLED" ? (
        <Text style={styles.callOut}>You're being called! Head to the clinic now.</Text>
      ) : (
        <Text style={styles.subtle}>Status: {ticket.status}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#F8FAFC" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  label: { fontSize: 12, fontWeight: "700", color: "#64748B", letterSpacing: 2 },
  token: { fontSize: 56, fontWeight: "900", color: "#0F172A", marginTop: 6, letterSpacing: 2 },
  statusBadge: {
    marginTop: 12,
    backgroundColor: "#0EA5E9",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusText: { color: "#fff", fontWeight: "800", letterSpacing: 1 },
  bigNumber: { fontSize: 96, fontWeight: "900", color: "#0F766E", marginTop: 24 },
  bigLabel: { fontSize: 18, color: "#475569", marginTop: -8 },
  eta: { fontSize: 16, color: "#475569", marginTop: 18 },
  callOut: { fontSize: 18, color: "#0F766E", marginTop: 28, fontWeight: "700", textAlign: "center" },
  subtle: { fontSize: 16, color: "#475569", marginTop: 28 },
  empty: { color: "#475569", fontSize: 16 },
  error: { color: "#BE123C", marginTop: 12 },
});

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import client from "@/api/client";
import { useAuth } from "@/auth/AuthContext";
import { setCacheValue, getCacheValue } from "@/auth/storage";
import type { DoseSchedule, QueueTicket } from "@/api/types";
import type { RootStackParamList } from "@/navigation";

const QUEUE_CACHE_KEY = "queue.me.snapshot";
const DOSES_CACHE_KEY = "doses.me.snapshot";

export default function HomeScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user, signOut } = useAuth();
  const [ticket, setTicket] = useState<QueueTicket | null>(
    () => getCacheValue<QueueTicket | null>(QUEUE_CACHE_KEY)?.value ?? null,
  );
  const [schedules, setSchedules] = useState<DoseSchedule[]>(
    () => getCacheValue<DoseSchedule[]>(DOSES_CACHE_KEY)?.value ?? [],
  );
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [ticketRes, doseRes] = await Promise.all([
        client.get<{ data: QueueTicket | null }>("/queue-tickets/me"),
        client.get<{ data: { items: DoseSchedule[] } }>("/dose-schedules/me"),
      ]);
      const t = ticketRes.data?.data ?? null;
      const items = doseRes.data?.data?.items ?? [];
      setTicket(t);
      setSchedules(items);
      setCacheValue(QUEUE_CACHE_KEY, t);
      setCacheValue(DOSES_CACHE_KEY, items);
    } catch {
      /* offline — keep cached state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const nextDose =
    schedules.find((s) => s.status === "ACTIVE")?.nextDueDose ??
    schedules[0]?.nextDueDose ??
    null;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.hello}>Hi, {user?.firstName ?? "there"}</Text>
          <Text style={styles.subhello}>{user?.phone}</Text>
        </View>
        <TouchableOpacity onPress={signOut}>
          <Text style={styles.signOut}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <Card>
        <Text style={styles.cardTitle}>My Queue Ticket</Text>
        {ticket ? (
          <>
            <Text style={styles.ticketCode}>{ticket.tokenCode}</Text>
            <Text style={styles.ticketLine}>
              {ticket.status === "WAITING"
                ? `${ticket.peopleAhead} people ahead — ETA ${ticket.etaMinutes ?? "—"} min`
                : `Status: ${ticket.status}`}
            </Text>
            <TouchableOpacity
              style={styles.cardLink}
              onPress={() => navigation.navigate("QueueTicket")}
            >
              <Text style={styles.cardLinkText}>Watch live →</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.placeholder}>
            You don't have an active queue ticket today.
          </Text>
        )}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Next Dose</Text>
        {nextDose ? (
          <>
            <Text style={styles.ticketCode}>Dose {nextDose.doseNumber}</Text>
            <Text style={styles.ticketLine}>Due {nextDose.dueDate}</Text>
            <TouchableOpacity
              style={styles.cardLink}
              onPress={() => navigation.navigate("DoseSchedule")}
            >
              <Text style={styles.cardLinkText}>See full schedule →</Text>
            </TouchableOpacity>
          </>
        ) : loading ? (
          <ActivityIndicator />
        ) : (
          <Text style={styles.placeholder}>
            No active PEP regimen. Visit the clinic to start one.
          </Text>
        )}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Quick actions</Text>
        <View style={styles.actionRow}>
          <Action
            label="Report exposure"
            onPress={() => navigation.navigate("ExposureIntake")}
          />
          <Action
            label="My documents"
            onPress={() => navigation.navigate("Documents")}
          />
          <Action label="Profile" onPress={() => navigation.navigate("Profile")} />
        </View>
      </Card>
    </ScrollView>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.action} onPress={onPress}>
      <Text style={styles.actionText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#F1F5F9" },
  content: { padding: 16, paddingBottom: 48 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  hello: { fontSize: 22, fontWeight: "800", color: "#0F172A" },
  subhello: { fontSize: 12, color: "#64748B", marginTop: 2 },
  signOut: { color: "#0F766E", fontWeight: "700" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  ticketCode: { fontSize: 28, fontWeight: "800", color: "#0F172A", marginTop: 6 },
  ticketLine: { fontSize: 14, color: "#475569", marginTop: 2 },
  placeholder: { fontSize: 14, color: "#94A3B8", marginTop: 8 },
  cardLink: { marginTop: 10 },
  cardLinkText: { color: "#0F766E", fontWeight: "700" },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
    gap: 8,
  },
  action: {
    flexGrow: 1,
    flexBasis: "30%",
    backgroundColor: "#E2E8F0",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  actionText: { color: "#0F172A", fontWeight: "700", fontSize: 13 },
});

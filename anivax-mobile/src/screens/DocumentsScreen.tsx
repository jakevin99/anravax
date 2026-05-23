import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { launchCamera, launchImageLibrary } from "react-native-image-picker";

import client from "@/api/client";

type FileRow = {
  id: number;
  kind: string;
  mime: string;
  bytes: number;
  createdAt: string;
};

const KIND_OPTIONS: { kind: string; label: string }[] = [
  { kind: "ID_CARD", label: "ID card" },
  { kind: "ANIMAL_PHOTO", label: "Animal photo" },
  { kind: "VACCINE_CARD", label: "Vaccine card" },
  { kind: "OTHER", label: "Other" },
];

export default function DocumentsScreen() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await client.get<{ data: { items: FileRow[] } }>("/files/me");
      setFiles(res.data?.data?.items ?? []);
    } catch {
      // /files endpoint lands in Phase 5; show empty state until then.
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const upload = async (kind: string, source: "camera" | "library") => {
    if (uploading) return;
    setUploading(true);
    try {
      const result =
        source === "camera"
          ? await launchCamera({ mediaType: "photo", quality: 0.8 })
          : await launchImageLibrary({ mediaType: "photo", quality: 0.8 });
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      const form = new FormData();
      form.append("kind", kind);
      // FormData on RN accepts a {uri, name, type} blob shape.
      // Cast to unknown to satisfy TS; RN's FormData.append signature allows this.
      form.append(
        "file",
        {
          uri: asset.uri,
          name: asset.fileName ?? "upload.jpg",
          type: asset.type ?? "image/jpeg",
        } as unknown as Blob,
      );
      await client.post("/files", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await reload();
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.root}>
      <Text style={styles.title}>My documents</Text>
      <View style={styles.actionsGrid}>
        {KIND_OPTIONS.map((opt) => (
          <View key={opt.kind} style={styles.actionCol}>
            <Text style={styles.actionLabel}>{opt.label}</Text>
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.actionPill}
                onPress={() => upload(opt.kind, "camera")}
              >
                <Text style={styles.actionPillText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionPill}
                onPress={() => upload(opt.kind, "library")}
              >
                <Text style={styles.actionPillText}>Gallery</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color="#0F766E" />
      ) : (
        <FlatList
          data={files}
          keyExtractor={(f) => String(f.id)}
          ListEmptyComponent={() => (
            <Text style={styles.empty}>No documents uploaded yet.</Text>
          )}
          renderItem={({ item }) => (
            <View style={styles.fileRow}>
              <Text style={styles.fileKind}>{item.kind}</Text>
              <Text style={styles.fileMeta}>
                {item.mime} · {Math.round(item.bytes / 1024)} KB
              </Text>
              <Text style={styles.fileDate}>{item.createdAt}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, backgroundColor: "#F8FAFC" },
  title: { fontSize: 22, fontWeight: "800", color: "#0F172A", marginBottom: 16 },
  actionsGrid: { gap: 12, marginBottom: 16 },
  actionCol: { gap: 6 },
  actionLabel: { fontSize: 12, color: "#475569", fontWeight: "700", letterSpacing: 1 },
  actionRow: { flexDirection: "row", gap: 8 },
  actionPill: {
    flex: 1,
    backgroundColor: "#0F766E",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  actionPillText: { color: "#fff", fontWeight: "700" },
  empty: { color: "#94A3B8", fontSize: 14, marginTop: 24, textAlign: "center" },
  fileRow: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  fileKind: { fontWeight: "700", color: "#0F172A" },
  fileMeta: { fontSize: 12, color: "#64748B", marginTop: 2 },
  fileDate: { fontSize: 11, color: "#94A3B8", marginTop: 2 },
});

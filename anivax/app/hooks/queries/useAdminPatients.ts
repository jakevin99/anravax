import { useQuery } from "@tanstack/react-query";

import { getApiBaseUrl, rawFetch } from "../../services/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import { listRecyclePatients } from "../../services/queueService";

const API_BASE = getApiBaseUrl();

export type ApiPatientRecord = {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  birth_date: string;
  sex: string;
  registered_at: string | null;
  created_at: string;
};

async function fetchAdminPatients(): Promise<ApiPatientRecord[]> {
  const res = await rawFetch(`${API_BASE}/patients?page=1&page_size=500`);
  const json = (await res.json()) as {
    data?: { items?: ApiPatientRecord[] };
    error?: string;
  };
  if (!res.ok) {
    throw new Error(json.error ?? "Failed to load patients.");
  }
  return json.data?.items ?? [];
}

export function useAdminPatientsQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.patients.list({ page: 1, pageSize: 500 }),
    queryFn: fetchAdminPatients,
    enabled,
  });
}

export function useRecyclePatientsQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.patients.recycle({ page: 1, pageSize: 500 }),
    queryFn: () => listRecyclePatients({ page: 1, pageSize: 500 }),
    enabled,
  });
}

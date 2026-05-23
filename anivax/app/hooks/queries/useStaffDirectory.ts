import { useQuery } from "@tanstack/react-query";

import { getApiBaseUrl, rawFetch } from "../../services/apiClient";
import { queryKeys } from "../../lib/queryKeys";

const API_BASE = getApiBaseUrl();

export type StaffDirectoryRow = {
  id: string;
  name: string;
  roles: string;
  dateRegistered: string;
  firstName: string;
  lastName: string;
  username: string;
  roleId: number;
};

export type RoleOption = { id: number; name: string };

export type StaffDirectoryData = {
  staff: StaffDirectoryRow[];
  roles: RoleOption[];
};

async function fetchStaffDirectory(): Promise<StaffDirectoryData> {
  const [usersRes, rolesRes] = await Promise.all([
    rawFetch(`${API_BASE}/users`),
    rawFetch(`${API_BASE}/roles`),
  ]);
  const usersJson = (await usersRes.json()) as {
    data?: Array<{
      id: number;
      public_id: string;
      first_name: string;
      last_name: string;
      username: string;
      role_id: number;
      role_name: string;
      created_at: string;
    }>;
    error?: string;
  };
  const rolesJson = (await rolesRes.json()) as {
    data?: Array<{ id: number; name: string }>;
    error?: string;
  };
  if (!usersRes.ok) {
    throw new Error(usersJson.error ?? "Failed to load staff.");
  }
  const staff = (usersJson.data ?? [])
    .filter((u) => u.role_name !== "ADMIN")
    .map((u) => ({
      id: u.public_id || `u_${String(u.id).padStart(6, "0")}`,
      name: `${u.last_name.toUpperCase()}, ${u.first_name.toUpperCase()}`,
      roles: u.role_name,
      dateRegistered: new Date(u.created_at)
        .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        .toUpperCase(),
      firstName: u.first_name,
      lastName: u.last_name,
      username: u.username,
      roleId: u.role_id,
    }));
  const roles = (rolesJson.data ?? []).filter((r) => r.name !== "ADMIN");
  return { staff, roles };
}

export function useStaffDirectoryQuery() {
  return useQuery({
    queryKey: queryKeys.staff.directory(),
    queryFn: fetchStaffDirectory,
  });
}

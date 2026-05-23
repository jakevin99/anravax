import { fetchJson } from "./apiClient";

export type VisitGranularity = "daily" | "weekly" | "monthly" | "annual";

export interface TrendPoint {
  label: string;
  count: number;
}

export interface DistributionSlice {
  name: string;
  count: number;
}

export interface DashboardFilters {
  classification: string;
  healthFacility: string;
  startDate: string;
  endDate: string;
  patientStatus: string;
  ageGroup: string;
  gender: string;
}

export interface DashboardStats {
  visitTrends: Record<VisitGranularity, TrendPoint[]>;
  byBarangay: DistributionSlice[];
  byAnimalType: DistributionSlice[];
  byCaseCategory: DistributionSlice[];
  byInjuryType: DistributionSlice[];
  byAnimalStatusAfter14d: DistributionSlice[];
  byVaccinationStatus: DistributionSlice[];
  totalVisits: number;
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function fetchDashboardStats(
  filters: DashboardFilters,
): Promise<DashboardStats> {
  const params = new URLSearchParams({
    start_date: filters.startDate,
    end_date: filters.endDate,
    classification: filters.classification,
    health_facility: filters.healthFacility,
    patient_status: filters.patientStatus,
    age_group: filters.ageGroup,
    gender: filters.gender,
  });

  return fetchJson<DashboardStats>(`/dashboard/stats?${params.toString()}`);
}

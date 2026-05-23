import { useQuery } from "@tanstack/react-query";

import { queryKeys, type RegistryQueryParams } from "../../lib/queryKeys";
import { searchPatientRegistry } from "../../services/queueService";

export function usePatientRegistryQuery(
  params: RegistryQueryParams,
  enabled: boolean,
) {
  const { sort: _sort, ...apiParams } = params;
  return useQuery({
    queryKey: queryKeys.patients.registry(params),
    queryFn: () => searchPatientRegistry(apiParams),
    enabled,
  });
}

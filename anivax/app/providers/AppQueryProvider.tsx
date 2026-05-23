import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";

import { queryClient } from "../lib/queryClient";
import { setupDataSyncBridge } from "../services/dataSync";

export default function AppQueryProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    return setupDataSyncBridge();
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

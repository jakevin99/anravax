import type { Route } from "./+types/queue-records-history";
import PatientConsultationHistoryPage from "../components/PatientConsultationHistoryPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Anivax — Consultation history" },
    {
      name: "description",
      content: "Patient profile and paginated consultation history.",
    },
  ];
}

export default function QueueRecordsHistoryRoute() {
  return <PatientConsultationHistoryPage />;
}

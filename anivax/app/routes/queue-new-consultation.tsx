import type { Route } from "./+types/queue-new-consultation";
import AddUserRecordsPage from "../components/AddUserRecordsPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Anivax — New consultation" },
    {
      name: "description",
      content: "Look up an existing patient from the registry before starting a new consultation.",
    },
  ];
}

export default function QueueNewConsultationRoute() {
  return <AddUserRecordsPage variant="new-consultation" />;
}

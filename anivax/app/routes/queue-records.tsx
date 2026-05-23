import type { Route } from "./+types/queue-records";
import AddUserRecordsPage from "../components/AddUserRecordsPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Anivax — Records" },
    {
      name: "description",
      content: "Browse and search patient records in the registry.",
    },
  ];
}

export default function QueueRecordsRoute() {
  return <AddUserRecordsPage variant="records" />;
}

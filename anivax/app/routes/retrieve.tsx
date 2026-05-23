import type { Route } from "./+types/retrieve";
import RetrieveHistoryPage from "../components/RetrieveHistoryPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Anivax — Patient History" },
    {
      name: "description",
      content: "Retrieved patient history for the selected appointment.",
    },
  ];
}

export default function RetrieveRoute() {
  return <RetrieveHistoryPage />;
}

import type { Route } from "./+types/dashboard";
import DashboardPage from "../components/DashboardPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Anivax — Dashboard" },
    {
      name: "description",
      content: "Patient visit trends and distribution analytics for Anivax.",
    },
  ];
}

export default function DashboardRoute() {
  return <DashboardPage />;
}

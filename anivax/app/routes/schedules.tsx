import type { Route } from "./+types/schedules";
import SchedulesPage from "../components/SchedulesPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Anivax — Schedules" },
    {
      name: "description",
      content: "Schedules management for Anivax appointments.",
    },
  ];
}

export default function SchedulesRoute() {
  return <SchedulesPage />;
}

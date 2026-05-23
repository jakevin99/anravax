import type { Route } from "./+types/queue-schedule-appointment";
import ScheduleAppointmentPage from "../components/ScheduleAppointmentPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Anivax — Schedule appointment" },
    { name: "description", content: "Schedule a vaccination appointment and exposure history." },
  ];
}

export default function QueueScheduleAppointmentRoute() {
  return <ScheduleAppointmentPage />;
}

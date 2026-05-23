import type { Route } from "./+types/queue";
import QueuePage from "../components/QueuePage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Anivax — Queue" },
    {
      name: "description",
      content: "Appointment queue and patient lookup for Anivax staff.",
    },
  ];
}

export default function QueueRoute() {
  return <QueuePage />;
}

import type { Route } from "./+types/queue-create-profile";
import CreateProfilePage from "../components/CreateProfilePage";

export function meta({ params }: Route.MetaArgs) {
  const isRetrieve = Boolean(params.patientId);
  return [
    { title: isRetrieve ? "Anivax — Patient profile" : "Anivax — Create profile" },
    {
      name: "description",
      content: isRetrieve
        ? "View and update a patient profile."
        : "Create a new patient profile.",
    },
  ];
}

export default function QueueCreateProfileRoute() {
  return <CreateProfilePage />;
}

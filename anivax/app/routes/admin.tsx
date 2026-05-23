import type { Route } from "./+types/admin";
import AdminDashboardPage from "../components/AdminDashboardPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Anivax — Admin" },
    {
      name: "description",
      content: "Administrator dashboard for Anivax.",
    },
  ];
}

export default function AdminRoute() {
  return <AdminDashboardPage />;
}

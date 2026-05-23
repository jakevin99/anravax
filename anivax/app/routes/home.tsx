import type { Route } from "./+types/home";
import LoginPage from "../components/LoginPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Anivax — Login" },
    { name: "description", content: "Login to Anivax — Animal Vaccination Records" },
  ];
}

export default function Home() {
  return <LoginPage />;
}

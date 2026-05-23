import { Navigate } from "react-router";

/** Legacy URL from earlier builds; new consultation lives at `/queue/new-consultation`. */
export default function QueueAddUserRedirect() {
  return <Navigate to="/queue/new-consultation" replace />;
}

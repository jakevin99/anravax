import type { Route } from "./+types/queue-consultation-ocr";
import ConsultationOcrPage from "../components/ConsultationOcrPage";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Anivax — OCR processing" },
    { name: "description", content: "Upload and OCR processing for new consultation documents." },
  ];
}

export default function QueueConsultationOcrRoute() {
  return <ConsultationOcrPage />;
}

/**
 * Left-column vaccine summary — matches QUEUE screen inventory card in Figma.
 * Pulls live lots from `GET /api/v1/vaccine-lots` and groups by vaccine kind.
 */

import { useEffect, useMemo, useState } from "react";
import { listVaccineLots } from "../services/queueService";
import type { VaccineKind, VaccineLot } from "../types/domain";

interface RolledUpRow {
  code: string;
  name: string;
  kind: VaccineKind;
  qtyRemaining: number;
  earliestExpiry: string | null;
}

const KIND_DISPLAY_ORDER: VaccineKind[] = [
  "RABIES_VAX",
  "ERIG",
  "HRIG",
  "TT",
  "ATS",
];

function rollUp(lots: VaccineLot[]): RolledUpRow[] {
  const byCode = new Map<string, RolledUpRow>();
  for (const lot of lots) {
    const existing = byCode.get(lot.vaccineCode);
    if (existing) {
      existing.qtyRemaining += lot.qtyRemaining;
      if (
        lot.expiresOn &&
        (!existing.earliestExpiry || lot.expiresOn < existing.earliestExpiry)
      ) {
        existing.earliestExpiry = lot.expiresOn;
      }
    } else {
      byCode.set(lot.vaccineCode, {
        code: lot.vaccineCode,
        name: lot.vaccineName,
        kind: lot.vaccineKind,
        qtyRemaining: lot.qtyRemaining,
        earliestExpiry: lot.expiresOn ?? null,
      });
    }
  }
  return [...byCode.values()].sort((a, b) => {
    const ai = KIND_DISPLAY_ORDER.indexOf(a.kind);
    const bi = KIND_DISPLAY_ORDER.indexOf(b.kind);
    if (ai !== bi) return ai - bi;
    return a.code.localeCompare(b.code);
  });
}

function formatExpiry(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function statusFromQty(qty: number): { label: string; tone: "ok" | "low" | "out" } {
  if (qty <= 0) return { label: "Out", tone: "out" };
  if (qty <= 20) return { label: "Low stock", tone: "low" };
  return { label: "In stock", tone: "ok" };
}

export default function VaccineInventoryCard() {
  const [lots, setLots] = useState<VaccineLot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listVaccineLots()
      .then((data) => {
        if (!active) return;
        setLots(data);
      })
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : "Failed to load inventory.");
        setLots([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const rolled = useMemo(() => (lots ? rollUp(lots) : []), [lots]);

  return (
    <section className="box-border flex w-full flex-col rounded-sm border-2 border-[rgb(124,92,252)]/50 bg-white shadow-[4px_4px_4px_rgb(0_0_0/0.25)] min-[1180px]:h-full min-[1180px]:min-h-0">
      <h2 className="m-0 shrink-0 px-5 pb-1 pt-5 text-xl font-semibold tracking-tight text-[#7C5CFC]">
        Vaccine
      </h2>

      <div className="flex min-h-0 flex-col min-[1180px]:flex-1 min-[1180px]:min-h-0">
        <div className="flex shrink-0 flex-col">
          {lots === null ? (
            <p className="px-5 py-4 text-sm italic text-[#243B53]/60">
              Loading inventory…
            </p>
          ) : error ? (
            <p className="px-5 py-4 text-sm italic text-[#BF0D3E]">{error}</p>
          ) : rolled.length === 0 ? (
            <p className="px-5 py-4 text-sm italic text-[#243B53]/60">
              No vaccine lots on file. Add one via Manage Inventory.
            </p>
          ) : (
            rolled.map((row, idx) => (
              <VaccineRow
                key={row.code}
                name={row.code}
                exp={formatExpiry(row.earliestExpiry)}
                qty={String(row.qtyRemaining)}
                bordered={idx < rolled.length - 1}
                {...statusFromQty(row.qtyRemaining)}
              />
            ))
          )}
        </div>

        <div className="min-h-0 min-[1180px]:flex-1" aria-hidden />

        <div className="flex shrink-0 justify-center px-5 pb-6 pt-5">
          <button
            type="button"
            className="h-[25px] min-w-[196px] cursor-pointer border-none bg-[#D9E3EC] px-4 text-[11px] font-semibold text-[#243B53] transition-colors hover:bg-[#c9d5e0]"
          >
            Manage Inventory
          </button>
        </div>
      </div>
    </section>
  );
}

function VaccineRow({
  name,
  exp,
  qty,
  label,
  tone,
  bordered,
}: {
  name: string;
  exp: string;
  qty: string;
  label: string;
  tone: "ok" | "low" | "out";
  bordered?: boolean;
}) {
  const statusBg =
    tone === "ok"
      ? "bg-[rgb(79,209,165)]/50 text-[#2E8C6C]"
      : tone === "low"
        ? "bg-[rgb(244,180,0)]/40 text-[#7A5A00]"
        : "bg-[rgb(191,13,62)]/50 text-[#BF0D3E]";
  return (
    <div className={`relative px-5 py-4 ${bordered ? "border-b border-[#D9E3EC]" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-lg font-semibold leading-tight text-[#243B53]">{name}</p>
          <p className="mt-1 text-[10px] font-medium text-[#243B53]/50">Exp: {exp}</p>
        </div>
        <span className="shrink-0 text-lg font-semibold tabular-nums text-[#243B53]">{qty}</span>
      </div>
      <div className="mt-2 flex justify-end">
        <span
          className={`inline-flex min-h-[19px] min-w-[53px] items-center justify-center rounded-lg px-2 text-[11px] font-semibold ${statusBg}`}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

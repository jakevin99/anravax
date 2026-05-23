import type { DoctorsOrder } from "../types/domain";
import { parseBiteCategory } from "./biteCategory";

export function createDefaultDoctorsOrder(): DoctorsOrder {
  return {
    pertinentPE: "",
    diagnosis: "",
    plan: {
      booster: false,
      prep: false,
      pep: false,
      ats: { given: false, units: "" },
      tetanusToxoid: { given: false, note: "" },
      erig: false,
      arv: false,
      fic: false,
    },
    homeMeds: {
      amoxicillin: {},
      paracetamol: {},
      mefenamicAcid: {},
      others: "",
    },
    bodyMarks: [],
  };
}

export function normalizeDoctorsOrder(raw: unknown): DoctorsOrder {
  const base = createDefaultDoctorsOrder();
  if (!raw || typeof raw !== "object") return base;

  const o = raw as Partial<DoctorsOrder>;
  const planIn = o.plan && typeof o.plan === "object" ? o.plan : {};
  const homeIn = o.homeMeds && typeof o.homeMeds === "object" ? o.homeMeds : {};

  return {
    ...base,
    pertinentPE: typeof o.pertinentPE === "string" ? o.pertinentPE : base.pertinentPE,
    diagnosis: typeof o.diagnosis === "string" ? o.diagnosis : base.diagnosis,
    biteCategory: parseBiteCategory(o.biteCategory),
    plan: {
      ...base.plan,
      ...planIn,
      booster: Boolean(planIn.booster),
      prep: Boolean(planIn.prep),
      pep: Boolean(planIn.pep),
      ats: { ...base.plan.ats, ...(planIn.ats ?? {}) },
      tetanusToxoid: { ...base.plan.tetanusToxoid, ...(planIn.tetanusToxoid ?? {}) },
      erig: Boolean(planIn.erig),
      arv: Boolean(planIn.arv),
      fic: Boolean(planIn.fic),
    },
    homeMeds: {
      ...base.homeMeds,
      ...homeIn,
      amoxicillin: { ...base.homeMeds.amoxicillin, ...(homeIn.amoxicillin ?? {}) },
      paracetamol: { ...base.homeMeds.paracetamol, ...(homeIn.paracetamol ?? {}) },
      mefenamicAcid: { ...base.homeMeds.mefenamicAcid, ...(homeIn.mefenamicAcid ?? {}) },
      others: typeof homeIn.others === "string" ? homeIn.others : base.homeMeds.others,
    },
    bodyMarks: Array.isArray(o.bodyMarks) ? o.bodyMarks : base.bodyMarks,
  };
}

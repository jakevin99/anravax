/**
 * Default Doctor's Order document and normalization for partial DB payloads.
 */

export function defaultDoctorsOrderPayload() {
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

export function normalizeDoctorsOrderPayload(raw) {
  const base = defaultDoctorsOrderPayload();
  if (!raw || typeof raw !== "object") return base;

  const planIn = raw.plan && typeof raw.plan === "object" ? raw.plan : {};
  const homeIn = raw.homeMeds && typeof raw.homeMeds === "object" ? raw.homeMeds : {};

  return {
    ...base,
    pertinentPE: typeof raw.pertinentPE === "string" ? raw.pertinentPE : base.pertinentPE,
    diagnosis: typeof raw.diagnosis === "string" ? raw.diagnosis : base.diagnosis,
    biteCategory: (() => {
      const n = Number(raw.biteCategory);
      return n >= 1 && n <= 4 ? n : undefined;
    })(),
    plan: {
      ...base.plan,
      ...planIn,
      booster: Boolean(planIn.booster),
      prep: Boolean(planIn.prep),
      pep: Boolean(planIn.pep),
      ats: { ...base.plan.ats, ...(planIn.ats && typeof planIn.ats === "object" ? planIn.ats : {}) },
      tetanusToxoid: {
        ...base.plan.tetanusToxoid,
        ...(planIn.tetanusToxoid && typeof planIn.tetanusToxoid === "object"
          ? planIn.tetanusToxoid
          : {}),
      },
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
    bodyMarks: Array.isArray(raw.bodyMarks) ? raw.bodyMarks : base.bodyMarks,
  };
}

export function parseDoctorsOrderJson(json) {
  if (!json) return null;
  try {
    return normalizeDoctorsOrderPayload(JSON.parse(json));
  } catch {
    return null;
  }
}

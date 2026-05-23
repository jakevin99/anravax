/**
 * Vaccination tab payload (form + nurse's note) stored in vaccination_records.payload_json.
 */

export function defaultVaccinationPayload() {
  return {
    vaccination: {
      slots: [],
      observationIso: "",
      pcecv: false,
      pvrv: false,
      siteId: false,
      siteIm: false,
      brandSpeeda: false,
      brandVaxiran: false,
      brandAbhayrab: false,
      erigEquirab: false,
      erigDoseMl: "",
      erigDateIso: "",
      erigTime24: "",
      animalStatus: "",
      treatmentStatus: "",
      receivedBy: "",
    },
    nursesNote: {
      rows: [],
    },
  };
}

export function normalizeVaccinationPayload(raw) {
  const base = defaultVaccinationPayload();
  if (!raw || typeof raw !== "object") return base;

  const vIn = raw.vaccination && typeof raw.vaccination === "object" ? raw.vaccination : {};
  const nIn = raw.nursesNote && typeof raw.nursesNote === "object" ? raw.nursesNote : {};

  return {
    vaccination: {
      ...base.vaccination,
      ...vIn,
      slots: Array.isArray(vIn.slots) ? vIn.slots : base.vaccination.slots,
    },
    nursesNote: {
      rows: Array.isArray(nIn.rows) ? nIn.rows : base.nursesNote.rows,
    },
  };
}

export function parseVaccinationPayloadJson(json) {
  if (!json) return null;
  try {
    return normalizeVaccinationPayload(JSON.parse(json));
  } catch {
    return null;
  }
}

/** Extract indexed columns for vaccination_records row. */
export function vaccinationRecordColumns(normalized) {
  const v = normalized?.vaccination ?? {};
  const animal = v.animalStatus != null && String(v.animalStatus).trim() !== ""
    ? String(v.animalStatus)
    : null;
  const treatment =
    v.treatmentStatus != null && String(v.treatmentStatus).trim() !== ""
      ? String(v.treatmentStatus)
      : null;
  const observation =
    v.observationIso != null && String(v.observationIso).trim() !== ""
      ? String(v.observationIso)
      : null;
  return { animal_status_after_14d: animal, treatment_status: treatment, observation_date: observation };
}

/**
 * Post-exposure prophylaxis (PEP) regimen calculator.
 *
 * Each regimen is `offsets`: an array of day numbers from Day 0 (the day of
 * the first dose) on which the patient must come back for the next dose.
 * The number of physical injection sites at each visit is `sitesPerVisit`
 * — useful for inventory deduction when a dose is marked "given".
 *
 * Sources:
 *  - WHO 2018 Rabies vaccines position paper (intradermal 2-site IPC, Essen IM, Zagreb IM 2-1-1).
 *  - Philippines Rabies Prevention and Control Program — DOH AO 2018-0013.
 */

export const REGIMENS = Object.freeze({
  WHO_IPC_2_2_2_0_2: {
    label: "WHO 2-site Intradermal (Updated Thai Red Cross)",
    route: "ID",
    offsets: [0, 3, 7, 28],
    sitesPerVisit: 2,
  },
  WHO_TRC_2_2_2_0_2: {
    label: "Thai Red Cross 2-site ID",
    route: "ID",
    offsets: [0, 3, 7, 28],
    sitesPerVisit: 2,
  },
  ESSEN_IM_1_1_1_1: {
    label: "Essen Intramuscular (1-1-1-1-1)",
    route: "IM",
    offsets: [0, 3, 7, 14, 28],
    sitesPerVisit: 1,
  },
  ZAGREB_IM_2_0_1_0_1: {
    label: "Zagreb Intramuscular (2-1-1)",
    route: "IM",
    offsets: [0, 7, 21],
    sitesPerVisit: 2,
  },
  BOOSTER_2_VISIT: {
    label: "Booster (previously immunised, 2-visit)",
    route: "ID",
    offsets: [0, 3],
    sitesPerVisit: 1,
  },
});

export function isRegimenKey(key) {
  return Object.prototype.hasOwnProperty.call(REGIMENS, String(key));
}

export function listRegimens() {
  return Object.entries(REGIMENS).map(([key, value]) => ({ key, ...value }));
}

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

function isoDayOnly(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * @param {string} day0Iso  YYYY-MM-DD
 * @param {number} offsetDays  whole-day offset
 */
function addDaysIso(day0Iso, offsetDays) {
  const [y, m, d] = String(day0Iso)
    .split("-")
    .map((s) => Number(s));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    throw new Error(`Invalid day0Iso: '${day0Iso}'`);
  }
  // Anchor at noon to avoid DST oddities.
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  dt.setDate(dt.getDate() + offsetDays);
  return isoDayOnly(dt);
}

/**
 * Returns an array of `{ doseNumber, dueDate, route, sites }` for the given
 * regimen and Day 0 date. Pure function — does not touch the DB.
 */
export function buildSchedule(regimenKey, day0Iso) {
  if (!isRegimenKey(regimenKey)) {
    throw new Error(
      `Unknown regimen '${regimenKey}'. Expected one of: ${Object.keys(REGIMENS).join(", ")}`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day0Iso ?? ""))) {
    throw new Error(`Invalid day0 date '${day0Iso}'. Expected YYYY-MM-DD.`);
  }
  const r = REGIMENS[regimenKey];
  return r.offsets.map((offset, idx) => ({
    doseNumber: idx + 1,
    dueDate: addDaysIso(day0Iso, offset),
    route: r.route,
    sites: r.sitesPerVisit,
    offsetDays: offset,
  }));
}

/**
 * Given a list of dose rows (each {givenAt, dueDate}), return the next dose
 * that has not been administered yet, or `null` if all are complete.
 */
export function nextDueDose(doses) {
  if (!Array.isArray(doses)) return null;
  const open = doses
    .filter((d) => !d.givenAt)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  return open[0] ?? null;
}

/**
 * Map an exposure record + clinical category to a WHO recommendation.
 *
 * `category` here is the existing 1..5 priority from the queue, NOT the WHO
 * exposure category. We infer the WHO category from `siteOfInjury` /
 * `washedInjury` heuristics so the doctor can override.
 *
 * Returns:
 *   {
 *     whoCategory: "I" | "II" | "III",
 *     recommendation: "OBSERVE" | "WOUND_CARE_AND_VACCINE" | "WOUND_CARE_VACCINE_AND_RIG",
 *     suggestedRegimens: ["WHO_IPC_2_2_2_0_2", ...]
 *   }
 */
export function classifyExposure({
  siteOfInjury = "",
  washedInjury = false,
  animalVaccinated = false,
  hasRabiesImmunisation = false,
} = {}) {
  const site = String(siteOfInjury).toLowerCase();
  const headOrNeck = /head|neck|face|nape|scalp/.test(site);
  const hand = /hand|finger|palm/.test(site);
  const broken = /bite|deep|laceration|puncture|bleed/.test(site);
  const lickIntact = /lick.*intact/.test(site) || site === "lick";
  const touched = /touch|fed|stroke/.test(site) && !broken;

  let whoCategory = "II";
  if (lickIntact || touched) whoCategory = "I";
  if (broken || headOrNeck || hand) whoCategory = "III";

  let recommendation;
  if (whoCategory === "I") {
    recommendation = "OBSERVE";
  } else if (whoCategory === "II") {
    recommendation = "WOUND_CARE_AND_VACCINE";
  } else {
    recommendation = "WOUND_CARE_VACCINE_AND_RIG";
  }

  const suggestedRegimens =
    whoCategory === "I"
      ? []
      : hasRabiesImmunisation
        ? ["BOOSTER_2_VISIT"]
        : ["WHO_IPC_2_2_2_0_2", "ESSEN_IM_1_1_1_1", "ZAGREB_IM_2_0_1_0_1"];

  return {
    whoCategory,
    recommendation,
    suggestedRegimens,
    notes: {
      washedInjury: Boolean(washedInjury),
      animalVaccinated: Boolean(animalVaccinated),
    },
  };
}

/**
 * Convenience: status label for a dose row, given today's date.
 *  - given_at present: "GIVEN"
 *  - due_date < today: "OVERDUE"
 *  - due_date === today: "DUE"
 *  - else: "UPCOMING"
 */
export function doseStatus(dose, todayIso) {
  if (dose?.givenAt) return "GIVEN";
  const today = todayIso || isoDayOnly(new Date());
  if (!dose?.dueDate) return "UPCOMING";
  if (dose.dueDate < today) return "OVERDUE";
  if (dose.dueDate === today) return "DUE";
  return "UPCOMING";
}

export { isoDayOnly };

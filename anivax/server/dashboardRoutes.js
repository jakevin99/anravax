/**
 * Dashboard analytics: visit trends, barangay distribution, animal types.
 */

import { all } from "./db.js";
import { requireAuth } from "./middleware/auth.js";

const staffRead = requireAuth({ actorKinds: ["staff"], authority: "SCHEDULES_READ" });

function parseIsoDate(value) {
  const s = value != null ? String(value).trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Address stored as "street, barangay, city, province, region, zip". */
function extractBarangay(address) {
  if (!address || typeof address !== "string") return "Unknown";
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[1];
  if (parts.length === 1) return parts[0];
  return "Unknown";
}

function ageMonthsFromBirth(birthDate) {
  const d = new Date(String(birthDate).trim() + "T12:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
  if (now.getDate() < d.getDate()) months -= 1;
  return months >= 0 ? months : null;
}

function matchesAgeGroup(birthDate, ageGroup) {
  if (!ageGroup || ageGroup === "ALL") return true;
  const months = ageMonthsFromBirth(birthDate);
  if (months == null) return false;
  switch (ageGroup) {
    case "INFANT":
      return months <= 11;
    case "TODDLER":
      return months >= 12 && months <= 47;
    case "SCHOOL":
      return months >= 48 && months <= 119;
    case "ADOLESCENT":
      return months >= 120 && months <= 227;
    case "ADULT":
      return months >= 228 && months <= 719;
    case "SENIOR":
      return months >= 720;
    default:
      return true;
  }
}

function mapPatientStatus(label) {
  const s = String(label ?? "").trim().toUpperCase();
  if (!s || s === "ALL") return null;
  if (s === "ENDED CONSULTS" || s === "ENDED") return "COMPLETED";
  return s.replace(/\s+/g, "_");
}

function mapGender(label) {
  const s = String(label ?? "").trim().toUpperCase();
  if (!s || s === "ALL") return null;
  if (s === "MALE" || s === "M") return "M";
  if (s === "FEMALE" || s === "F") return "F";
  return null;
}

function mapClassification(label) {
  const s = String(label ?? "").trim().toUpperCase();
  if (!s || s === "ALL" || s === "CONSULTATION") return null;
  if (s.includes("FOLLOW")) return "FOLLOW-UP";
  if (s.includes("REQUEST")) return "REQUESTS";
  if (s.includes("QUEUE")) return "QUEUE";
  return null;
}

const CASE_CATEGORY_LABELS = {
  1: "Category I (1)",
  2: "Category II (2)",
  3: "Category III (3)",
  4: "Category IV (4)",
};

function mapCaseCategory(raw) {
  const n = Number(raw);
  if (n >= 1 && n <= 4) return CASE_CATEGORY_LABELS[n];
  return "Unspecified";
}

function mapInjuryType(raw) {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-");
  if (s === "BITE") return "Bite";
  if (s === "NON-BITE") return "Non-bite";
  return "Unspecified";
}

function mapAnimalStatusAfter14d(raw) {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (s === "DEAD") return "Dead";
  if (s === "ALIVE") return "Alive";
  if (s === "LOST_STRAY" || s === "STRAY") return "Stray";
  return "Unspecified";
}

function mapVaccinationTreatmentStatus(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "COMPLETE" || s === "COMPLETED") return "Completed";
  if (s === "INCOMPLETE") return "Incomplete";
  return "Unspecified";
}

/** Effective treatment status: saved on vaccination record, else inferred from PEP doses. */
const TREATMENT_STATUS_EXPR = `
  COALESCE(
    NULLIF(trim(v.treatment_status), ''),
    (
      SELECT CASE
        WHEN NOT EXISTS (
          SELECT 1
          FROM dose_administrations da
          INNER JOIN pep_schedules ps ON ps.id = da.schedule_id
          WHERE ps.exposure_appointment_id = a.id
            AND da.given_at IS NULL
        ) AND EXISTS (
          SELECT 1
          FROM dose_administrations da
          INNER JOIN pep_schedules ps ON ps.id = da.schedule_id
          WHERE ps.exposure_appointment_id = a.id
        ) THEN 'COMPLETE'
        WHEN EXISTS (
          SELECT 1
          FROM dose_administrations da
          INNER JOIN pep_schedules ps ON ps.id = da.schedule_id
          WHERE ps.exposure_appointment_id = a.id
        ) THEN 'INCOMPLETE'
        ELSE NULL
      END
    )
  )
`;

function aggregateLabeledRows(rows, labelFn, allowedPatientIds) {
  const map = new Map();
  for (const row of rows) {
    if (allowedPatientIds && !allowedPatientIds.has(row.patient_id)) continue;
    const name = labelFn(row.raw);
    map.set(name, (map.get(name) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function buildTrendSql(granularity) {
  switch (granularity) {
    case "weekly":
      return {
        groupExpr: "strftime('%Y-W%W', a.scheduled_at)",
        labelExpr: "strftime('%Y-W%W', a.scheduled_at)",
      };
    case "monthly":
      return {
        groupExpr: "strftime('%Y-%m', a.scheduled_at)",
        labelExpr: "strftime('%Y-%m', a.scheduled_at)",
      };
    case "annual":
      return {
        groupExpr: "strftime('%Y', a.scheduled_at)",
        labelExpr: "strftime('%Y', a.scheduled_at)",
      };
    default:
      return {
        groupExpr: "date(a.scheduled_at)",
        labelExpr: "date(a.scheduled_at)",
      };
  }
}

/**
 * @param {import("express").Express} app
 * @param {string} API_PREFIX
 */
export function mountDashboardRoutes(app, API_PREFIX) {
  const base = `${API_PREFIX}/dashboard`;

  app.get(`${base}/stats`, staffRead, async (req, res, next) => {
    try {
      const startDate = parseIsoDate(req.query.start_date);
      const endDate = parseIsoDate(req.query.end_date);
      if (!startDate || !endDate) {
        res.status(400).json({ error: "Query 'start_date' and 'end_date' (YYYY-MM-DD) are required." });
        return;
      }

      const classification = mapClassification(req.query.classification);
      const healthFacility = req.query.health_facility
        ? String(req.query.health_facility).trim()
        : "";
      const patientStatus = mapPatientStatus(req.query.patient_status);
      const ageGroup = req.query.age_group ? String(req.query.age_group).trim().toUpperCase() : "ALL";
      const gender = mapGender(req.query.gender);

      const where = ["date(a.scheduled_at) >= date(?)", "date(a.scheduled_at) <= date(?)"];
      const params = [startDate, endDate];

      if (classification) {
        where.push("a.tab = ?");
        params.push(classification);
      }
      if (patientStatus) {
        where.push("a.status = ?");
        params.push(patientStatus);
      }
      if (gender) {
        where.push("p.sex = ?");
        params.push(gender);
      }
      if (healthFacility) {
        where.push(
          `(lower(COALESCE(e.place_of_incidence, '')) LIKE ? OR lower(COALESCE(p.address, '')) LIKE ?)`,
        );
        const like = `%${healthFacility.toLowerCase()}%`;
        params.push(like, like);
      }

      const whereSql = where.join(" AND ");

      const baseFrom = `
        FROM appointments a
        INNER JOIN patients p ON p.id = a.patient_id
        LEFT JOIN exposure_records e ON e.appointment_id = a.id
        LEFT JOIN doctors_orders d ON d.appointment_id = a.id
        LEFT JOIN vaccination_records v ON v.appointment_id = a.id
        WHERE ${whereSql}
      `;

      const granularities = ["daily", "weekly", "monthly", "annual"];
      const visitTrends = {};

      for (const g of granularities) {
        const { groupExpr, labelExpr } = buildTrendSql(g);
        const rows = await all(
          `
          SELECT ${labelExpr} AS label, COUNT(*) AS count
          ${baseFrom}
          GROUP BY ${groupExpr}
          ORDER BY label ASC
        `,
          params,
        );
        visitTrends[g] = rows.map((r) => ({
          label: String(r.label ?? ""),
          count: Number(r.count) || 0,
        }));
      }

      const patientRows = await all(
        `
          SELECT DISTINCT p.id AS patient_id, p.address, p.birth_date
          ${baseFrom}
        `,
        params,
      );

      const filteredPatients = patientRows.filter((r) =>
        matchesAgeGroup(r.birth_date, ageGroup),
      );

      const barangayMap = new Map();
      for (const row of filteredPatients) {
        const brgy = extractBarangay(row.address);
        barangayMap.set(brgy, (barangayMap.get(brgy) ?? 0) + 1);
      }

      const byBarangay = [...barangayMap.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      const animalRows = await all(
        `
          SELECT COALESCE(NULLIF(trim(e.animal_type), ''), 'Unknown') AS name, COUNT(*) AS count
          ${baseFrom}
          GROUP BY COALESCE(NULLIF(trim(e.animal_type), ''), 'Unknown')
          ORDER BY count DESC
        `,
        params,
      );

      let byAnimalType = animalRows.map((r) => ({
        name: String(r.name ?? "Unknown"),
        count: Number(r.count) || 0,
      }));

      if (ageGroup && ageGroup !== "ALL") {
        const allowedIds = new Set(filteredPatients.map((r) => r.patient_id));
        const apptAnimalRows = await all(
          `
            SELECT
              COALESCE(NULLIF(trim(e.animal_type), ''), 'Unknown') AS name,
              a.patient_id
            ${baseFrom}
          `,
          params,
        );
        const animalMap = new Map();
        for (const row of apptAnimalRows) {
          if (!allowedIds.has(row.patient_id)) continue;
          const name = String(row.name ?? "Unknown");
          animalMap.set(name, (animalMap.get(name) ?? 0) + 1);
        }
        byAnimalType = [...animalMap.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count);
      }

      let byCaseCategory;
      let byInjuryType;

      if (ageGroup && ageGroup !== "ALL") {
        const allowedIds = new Set(filteredPatients.map((r) => r.patient_id));

        const categoryRows = await all(
          `
            SELECT
              json_extract(d.payload_json, '$.biteCategory') AS raw,
              a.patient_id
            ${baseFrom}
          `,
          params,
        );
        byCaseCategory = aggregateLabeledRows(categoryRows, mapCaseCategory, allowedIds);

        const injuryRows = await all(
          `
            SELECT COALESCE(e.bite_type, '') AS raw, a.patient_id
            ${baseFrom}
          `,
          params,
        );
        byInjuryType = aggregateLabeledRows(injuryRows, mapInjuryType, allowedIds);
      } else {
        const categorySqlRows = await all(
          `
            SELECT json_extract(d.payload_json, '$.biteCategory') AS raw, COUNT(*) AS count
            ${baseFrom}
            GROUP BY json_extract(d.payload_json, '$.biteCategory')
            ORDER BY count DESC
          `,
          params,
        );
        byCaseCategory = categorySqlRows.map((r) => ({
          name: mapCaseCategory(r.raw),
          count: Number(r.count) || 0,
        }));

        const injurySqlRows = await all(
          `
            SELECT COALESCE(e.bite_type, '') AS raw, COUNT(*) AS count
            ${baseFrom}
            GROUP BY COALESCE(e.bite_type, '')
            ORDER BY count DESC
          `,
          params,
        );
        byInjuryType = injurySqlRows.map((r) => ({
          name: mapInjuryType(r.raw),
          count: Number(r.count) || 0,
        }));
      }

      let byAnimalStatusAfter14d;
      let byVaccinationStatus;

      if (ageGroup && ageGroup !== "ALL") {
        const allowedIds = new Set(filteredPatients.map((r) => r.patient_id));

        const animalStatusRows = await all(
          `
            SELECT COALESCE(v.animal_status_after_14d, '') AS raw, a.patient_id
            ${baseFrom}
          `,
          params,
        );
        byAnimalStatusAfter14d = aggregateLabeledRows(
          animalStatusRows,
          mapAnimalStatusAfter14d,
          allowedIds,
        );

        const vaccinationStatusRows = await all(
          `
            SELECT ${TREATMENT_STATUS_EXPR} AS raw, a.patient_id
            ${baseFrom}
          `,
          params,
        );
        byVaccinationStatus = aggregateLabeledRows(
          vaccinationStatusRows,
          mapVaccinationTreatmentStatus,
          allowedIds,
        );
      } else {
        const animalStatusSqlRows = await all(
          `
            SELECT COALESCE(v.animal_status_after_14d, '') AS raw, COUNT(*) AS count
            ${baseFrom}
            GROUP BY COALESCE(v.animal_status_after_14d, '')
            ORDER BY count DESC
          `,
          params,
        );
        byAnimalStatusAfter14d = animalStatusSqlRows.map((r) => ({
          name: mapAnimalStatusAfter14d(r.raw),
          count: Number(r.count) || 0,
        }));

        const vaccinationStatusSqlRows = await all(
          `
            SELECT ${TREATMENT_STATUS_EXPR} AS raw, COUNT(*) AS count
            ${baseFrom}
            GROUP BY ${TREATMENT_STATUS_EXPR}
            ORDER BY count DESC
          `,
          params,
        );
        byVaccinationStatus = vaccinationStatusSqlRows.map((r) => ({
          name: mapVaccinationTreatmentStatus(r.raw),
          count: Number(r.count) || 0,
        }));
      }

      res.json({
        data: {
          visitTrends,
          byBarangay,
          byAnimalType,
          byCaseCategory,
          byInjuryType,
          byAnimalStatusAfter14d,
          byVaccinationStatus,
          totalVisits: filteredPatients.length,
        },
      });
    } catch (err) {
      next(err);
    }
  });
}

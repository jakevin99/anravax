/**
 * Mistral OCR document_annotation JSON schema for ABTC-style personal information forms.
 * @see https://docs.mistral.ai/api/endpoint/ocr
 */

export const PERSONAL_INFO_OCR_PROMPT =
  "Extract patient personal information from this ABTC registration form image or PDF. " +
  "Always fill lastName, firstName, and middleName as separate fields (never combine into one name field). " +
  "For region use the full label e.g. 'Region III (Central Luzon)'. For province use the exact province name e.g. 'Bataan'. " +
  "Use empty string for missing text fields. For sex return MALE or FEMALE. " +
  "For civil status return SINGLE, MARRIED, WIDOWED, or SEPARATED. " +
  "For blood type return A+, A-, B+, B-, AB+, AB-, O+, or O-. " +
  "For birthDate prefer YYYY-MM-DD. Set noMiddleName true when the form indicates no middle name.";

/** Mistral document_annotation_format payload for personal-info PDFs. */
export const PERSONAL_INFO_DOCUMENT_ANNOTATION_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "personal_information",
    strict: true,
    schema: {
      type: "object",
      properties: {
        registrationNo: { type: "string" },
        philhealthNo: { type: "string" },
        lastName: { type: "string" },
        firstName: { type: "string" },
        middleName: { type: "string" },
        suffix: { type: "string" },
        noMiddleName: { type: "boolean" },
        birthDate: { type: "string" },
        ageYears: { type: "string" },
        sex: { type: "string" },
        civilStatus: { type: "string" },
        placeOfBirth: { type: "string" },
        bloodType: { type: "string" },
        mobile: { type: "string" },
        email: { type: "string" },
        religion: { type: "string" },
        scPwdId: { type: "string" },
        telephone: { type: "string" },
        street: { type: "string" },
        region: { type: "string" },
        province: { type: "string" },
        city: { type: "string" },
        barangay: { type: "string" },
        zip: { type: "string" },
      },
      required: [
        "registrationNo",
        "philhealthNo",
        "lastName",
        "firstName",
        "middleName",
        "suffix",
        "noMiddleName",
        "birthDate",
        "ageYears",
        "sex",
        "civilStatus",
        "placeOfBirth",
        "bloodType",
        "mobile",
        "email",
        "religion",
        "scPwdId",
        "telephone",
        "street",
        "region",
        "province",
        "city",
        "barangay",
        "zip",
      ],
      additionalProperties: false,
    },
  },
};

/**
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
export function parsePersonalInfoAnnotation(raw) {
  if (raw == null) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return /** @type {Record<string, unknown>} */ (raw);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? /** @type {Record<string, unknown>} */ (parsed)
      : null;
  } catch {
    return null;
  }
}

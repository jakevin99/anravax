import type { CreateProfileFormState } from "../components/createProfileRecord";
import {
  getAllRegions,
  getBarangaysByMunicipality,
  getMunicipalitiesByProvince,
  getProvincesByRegion,
} from "@aivangogh/ph-address";
import type { PhAddressFormSlice } from "../components/PhilippineAddressBlock";

type PersonalFieldKey = keyof CreateProfileFormState;

const LABEL_TO_FIELD: Record<string, PersonalFieldKey> = {
  "registration number": "registrationNo",
  "registration no": "registrationNo",
  "reg no": "registrationNo",
  "philhealth no": "philhealthNo",
  "philhealth number": "philhealthNo",
  "philhealth": "philhealthNo",
  "last name": "lastName",
  "lastname": "lastName",
  "surname": "lastName",
  "family name": "lastName",
  "firstname": "firstName",
  "first name": "firstName",
  "given name": "firstName",
  "givenname": "firstName",
  "middle name": "middleName",
  "middlename": "middleName",
  "suffix": "suffix",
  "date of birth": "birthDate",
  "birth date": "birthDate",
  "birthdate": "birthDate",
  "dob": "birthDate",
  "age": "ageYears",
  "sex": "sex",
  "gender": "sex",
  "civil status": "civilStatus",
  "place of birth": "placeOfBirth",
  "blood type": "bloodType",
  "mobile number": "mobile",
  "mobile no": "mobile",
  "mobile": "mobile",
  "cellphone": "mobile",
  "cell phone": "mobile",
  "contact number": "mobile",
  "email address": "email",
  "email": "email",
  "religion": "religion",
  "sc pwd id no": "scPwdId",
  "sc pwd id": "scPwdId",
  "sc pwd id number": "scPwdId",
  "pwd id": "scPwdId",
  "telephone number": "telephone",
  "telephone no": "telephone",
  "telephone": "telephone",
  "house no street subdivision": "street",
  "house no street": "street",
  "street": "street",
  "street address": "street",
  "house no": "street",
  "region": "region",
  "province": "province",
  "city municipality": "city",
  "city": "city",
  "municipality": "city",
  "barangay": "barangay",
  "brgy": "barangay",
  "zip code": "zip",
  "zip": "zip",
};

const LABEL_ENTRIES = Object.entries(LABEL_TO_FIELD).sort((a, b) => b[0].length - a[0].length);

function normLabel(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\*+/g, "")
    .replace(/[_:]/g, " ")
    .toLowerCase()
    .replace(/[./,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactLabel(raw: string): string {
  return normLabel(raw).replace(/\s/g, "");
}

function cleanValue(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\*\*/g, "")
    .replace(/^\*|\*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldForLabel(label: string): PersonalFieldKey | undefined {
  const n = normLabel(label);
  const c = compactLabel(label);
  if (!n) return undefined;
  for (const [key, field] of LABEL_ENTRIES) {
    if (n === key || c === key.replace(/\s/g, "")) return field;
  }
  return undefined;
}

function isKnownLabel(label: string): boolean {
  return fieldForLabel(label) != null;
}

function nonEmptyCells(row: string[]): string[] {
  return row.map((c) => cleanValue(c)).filter(Boolean);
}

function looksLikeBloodType(v: string): boolean {
  return /^[ABO]{1,2}[+-]$/i.test(v.replace(/\s/g, ""));
}

function looksLikeAge(v: string): boolean {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 && n <= 130 && String(n) === v.replace(/\s/g, "");
}

function looksLikePersonName(v: string): boolean {
  const t = cleanValue(v);
  if (!t || t.length > 80) return false;
  if (/^\d+$/.test(t)) return false;
  if (looksLikeBloodType(t) || looksLikeAge(t)) return false;
  return /[A-Za-z]/.test(t);
}

function parseBirthDate(raw: string): string {
  const t = cleanValue(raw);
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const mdy = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(t);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

function normalizeSex(raw: string): string {
  const u = cleanValue(raw).toUpperCase();
  if (u === "M" || u === "MALE") return "MALE";
  if (u === "F" || u === "FEMALE") return "FEMALE";
  return "";
}

function normalizeCivilStatus(raw: string): string {
  const u = cleanValue(raw).toUpperCase();
  const options = ["SINGLE", "MARRIED", "WIDOWED", "SEPARATED"] as const;
  return options.find((o) => u === o || u.startsWith(o)) ?? u;
}

function normalizeBloodType(raw: string): string {
  const t = cleanValue(raw).toUpperCase().replace(/\s+/g, "");
  const options = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
  return options.find((o) => t === o) ?? t;
}

function normalizeReligion(raw: string): string {
  const u = cleanValue(raw).toUpperCase();
  const options = ["ROMAN CATHOLIC", "CHRISTIAN", "IGLESIA", "ISLAM", "OTHERS"] as const;
  return options.find((o) => u === o || u.includes(o)) ?? u;
}

function normalizeSuffix(raw: string): string {
  const u = cleanValue(raw).toUpperCase();
  if (!u || u === "NONE" || u === "N/A" || u === "NA") return "";
  const options = ["JR.", "SR.", "II", "III"] as const;
  return options.find((o) => u === o || u === o.replace(".", "")) ?? u;
}

function isEmptyMiddleName(raw: string): boolean {
  const u = cleanValue(raw).toUpperCase();
  return !u || u === "N/A" || u === "NA" || u === "NONE" || u === "NO MIDDLE NAME";
}

function valueMatchesField(field: PersonalFieldKey, value: string): boolean {
  const v = cleanValue(value);
  if (!v) return false;
  switch (field) {
    case "lastName":
    case "firstName":
    case "middleName":
    case "placeOfBirth":
    case "region":
    case "province":
    case "city":
    case "barangay":
    case "street":
      return looksLikePersonName(v) || v.length >= 2;
    case "ageYears":
      return looksLikeAge(v);
    case "bloodType":
      return looksLikeBloodType(v);
    case "birthDate":
      return Boolean(parseBirthDate(v));
    case "sex":
      return Boolean(normalizeSex(v));
    case "mobile":
    case "telephone":
      return /[\d(+]/.test(v);
    case "email":
      return v.includes("@");
    case "zip":
      return /^\d{4}$/.test(v);
    default:
      return true;
  }
}

function setFieldValue(target: Partial<CreateProfileFormState>, field: PersonalFieldKey, value: string) {
  const v = cleanValue(value);
  if (!v || !valueMatchesField(field, v)) return;

  switch (field) {
    case "birthDate":
      target.birthDate = parseBirthDate(v);
      break;
    case "sex": {
      const sex = normalizeSex(v);
      if (sex) target.sex = sex;
      break;
    }
    case "civilStatus":
      target.civilStatus = normalizeCivilStatus(v);
      break;
    case "bloodType":
      target.bloodType = normalizeBloodType(v);
      break;
    case "religion":
      target.religion = normalizeReligion(v);
      break;
    case "suffix":
      target.suffix = normalizeSuffix(v);
      break;
    case "middleName":
      if (isEmptyMiddleName(v)) {
        target.noMiddleName = true;
        target.middleName = "";
      } else {
        target.middleName = v;
        target.noMiddleName = false;
      }
      break;
    case "noMiddleName":
      break;
    default:
      target[field] = v;
  }
}

function assignField(target: Partial<CreateProfileFormState>, label: string, value: string) {
  const field = fieldForLabel(label);
  if (!field) return;
  setFieldValue(target, field, value);
}

function parseMarkdownTableRows(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue;
    const cells = trimmed.split("|").slice(1, -1).map((c) => cleanValue(c));
    if (cells.some(Boolean)) rows.push(cells);
  }
  return rows;
}

function parseLabelRowValueRow(rows: string[][]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const labels = nonEmptyCells(rows[i]);
    const values = nonEmptyCells(rows[i + 1]);
    if (labels.length < 1 || values.length < 1) continue;
    if (!labels.every(isKnownLabel)) continue;
    if (values.some(isKnownLabel)) continue;
    const n = Math.min(labels.length, values.length);
    for (let j = 0; j < n; j++) {
      const field = fieldForLabel(labels[j]);
      if (field && valueMatchesField(field, values[j])) pairs.push([labels[j], values[j]]);
    }
    i++;
  }
  return pairs;
}

function parseVerticalPairs(rows: string[][]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const labels = nonEmptyCells(rows[i]);
    const values = nonEmptyCells(rows[i + 1]);
    if (labels.length !== 1 || values.length !== 1) continue;
    if (!isKnownLabel(labels[0]) || isKnownLabel(values[0])) continue;
    const field = fieldForLabel(labels[0]);
    if (field && valueMatchesField(field, values[0])) {
      pairs.push([labels[0], values[0]]);
      i++;
    }
  }
  return pairs;
}

function pairsFromRow(cells: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const row = cells.map((c) => cleanValue(c));
  for (let i = 0; i < row.length; i++) {
    const label = row[i];
    if (!label || !isKnownLabel(label)) continue;
    const field = fieldForLabel(label);
    if (!field) continue;
    for (let j = i + 1; j < row.length; j++) {
      const next = row[j];
      if (!next || isKnownLabel(next)) break;
      if (valueMatchesField(field, next)) {
        pairs.push([label, next]);
        i = j;
        break;
      }
    }
  }
  return pairs;
}

function parseLabelValueLines(text: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = cleanValue(line.replace(/^\|?\s*|\s*\|?$/g, ""));
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.match(/^(.{2,60}?)\s*[:：]\s*(.+)$/);
    if (colon) {
      const field = fieldForLabel(colon[1]);
      if (field && valueMatchesField(field, colon[2])) pairs.push([colon[1], colon[2]]);
      continue;
    }
    const tabSplit = trimmed.match(/^(.{2,50}?)\t+\s*(.+)$/);
    if (tabSplit) {
      const field = fieldForLabel(tabSplit[1]);
      if (field && valueMatchesField(field, tabSplit[2])) pairs.push([tabSplit[1], tabSplit[2]]);
      continue;
    }
    const spaceSplit = trimmed.match(/^(.{2,45}?)\s{2,}(.+)$/);
    if (spaceSplit) {
      const field = fieldForLabel(spaceSplit[1]);
      if (field && valueMatchesField(field, spaceSplit[2])) pairs.push([spaceSplit[1], spaceSplit[2]]);
      continue;
    }
    const cells = trimmed.split("|").map((c) => cleanValue(c)).filter(Boolean);
    if (cells.length === 2 && isKnownLabel(cells[0])) {
      const field = fieldForLabel(cells[0]);
      if (field && valueMatchesField(field, cells[1])) pairs.push([cells[0], cells[1]]);
    }
  }
  return pairs;
}

/** Plain-text lines: label on one line, value on the next. */
function parseLabelNextLine(text: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const lines = text.split(/\r?\n/).map((l) => cleanValue(l)).filter(Boolean);
  for (let i = 0; i < lines.length - 1; i++) {
    const label = lines[i];
    const value = lines[i + 1];
    if (!isKnownLabel(label) || isKnownLabel(value)) continue;
    const field = fieldForLabel(label);
    if (field && valueMatchesField(field, value)) {
      pairs.push([label, value]);
      i++;
    }
  }
  return pairs;
}

/** Regex fallback for labels embedded in OCR prose (common on photo scans). */
function parseInlineLabelRegex(text: string): Array<[PersonalFieldKey, string]> {
  const patterns: Array<{ re: RegExp; field: PersonalFieldKey }> = [
    { re: /\b(?:last\s*name|surname)\b\s*[:：]?\s*([A-Za-zñÑ.\-' ]{2,60})/gi, field: "lastName" },
    { re: /\b(?:first\s*name|given\s*name)\b\s*[:：]?\s*([A-Za-zñÑ.\-' ]{2,60})/gi, field: "firstName" },
    { re: /\bmiddle\s*name\b\s*[:：]?\s*([A-Za-zñÑ.\-' ]{2,60})/gi, field: "middleName" },
    { re: /\bphilhealth\s*(?:no|number)?\.?\b\s*[:：]?\s*([0-9\- ]{6,20})/gi, field: "philhealthNo" },
    { re: /\bregistration\s*(?:no|number)?\.?\b\s*[:：]?\s*([A-Za-z0-9\- ]{2,30})/gi, field: "registrationNo" },
    { re: /\bprovince\b\s*[:：]?\s*([A-Za-zñÑ.\- ]{2,40})/gi, field: "province" },
    { re: /\bregion\b\s*[:：]?\s*([A-Za-z0-9ñÑ.\-() ]{2,50})/gi, field: "region" },
    { re: /\b(?:city|municipality)\b\s*[:：]?\s*([A-Za-zñÑ.\- ]{2,40})/gi, field: "city" },
    { re: /\bbarangay\b\s*[:：]?\s*([A-Za-zñÑ.\- ]{2,40})/gi, field: "barangay" },
    { re: /\bzip\s*code\b\s*[:：]?\s*(\d{4})/gi, field: "zip" },
  ];

  const pairs: Array<[PersonalFieldKey, string]> = [];
  for (const { re, field } of patterns) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m?.[1] && valueMatchesField(field, m[1])) {
      pairs.push([field, m[1].trim()]);
    }
  }
  return pairs;
}

function regionDisplayName(r: { name: string; designation?: string }) {
  const d = r.designation?.trim();
  if (!d || d === r.name) return r.name;
  return `${r.name} (${d})`;
}

function namesMatch(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const nb = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

function findRegionByName(input: string) {
  const regions = getAllRegions();
  const needle = cleanValue(input);
  if (!needle) return undefined;

  let hit = regions.find(
    (r) =>
      namesMatch(regionDisplayName(r), needle) ||
      namesMatch(r.name, needle) ||
      namesMatch(r.designation ?? "", needle),
  );
  if (hit) return hit;

  const roman = needle.match(/\b(i{1,3}|iv|v|vi{0,3}|ix|x|xi{0,3})\b/i)?.[1]?.toUpperCase();
  if (roman) {
    hit = regions.find((r) => r.name.toUpperCase().includes(roman) || r.name.toUpperCase().includes(`REGION ${roman}`));
  }
  return hit;
}

function findProvinceByName(input: string, regionCode?: string) {
  const needle = cleanValue(input);
  if (!needle) return { province: undefined, region: undefined };

  if (regionCode) {
    const p = getProvincesByRegion(regionCode).find((x) => namesMatch(x.name, needle));
    if (p) return { province: p, region: findRegionByCode(regionCode) };
  }

  const regions = getAllRegions();
  for (const r of regions) {
    const p = getProvincesByRegion(r.psgcCode).find((x) => namesMatch(x.name, needle));
    if (p) return { province: p, region: r };
  }
  return { province: undefined, region: undefined };
}

function findRegionByCode(code: string) {
  return getAllRegions().find((r) => r.psgcCode === code);
}

export function resolvePhAddressCodes(
  slice: Pick<PhAddressFormSlice, "region" | "province" | "city" | "barangay" | "zip">,
): Partial<PhAddressFormSlice> {
  const out: Partial<PhAddressFormSlice> = {
    region: slice.region?.trim() ?? "",
    province: slice.province?.trim() ?? "",
    city: slice.city?.trim() ?? "",
    barangay: slice.barangay?.trim() ?? "",
    zip: slice.zip?.trim() ?? "",
  };

  let regionHit = slice.region?.trim() ? findRegionByName(slice.region) : undefined;
  let provinceHit: { name: string; psgcCode: string } | undefined;
  let provinceRegion = regionHit;

  if (slice.province?.trim()) {
    const found = findProvinceByName(slice.province, regionHit?.psgcCode);
    provinceHit = found.province;
    if (found.region) {
      provinceRegion = found.region;
      regionHit = found.region;
    }
  }

  if (regionHit) {
    out.regionCode = regionHit.psgcCode;
    out.region = regionDisplayName(regionHit);
  }

  if (provinceHit && provinceRegion) {
    out.provinceCode = provinceHit.psgcCode;
    out.province = provinceHit.name;
    if (!out.regionCode) {
      out.regionCode = provinceRegion.psgcCode;
      out.region = regionDisplayName(provinceRegion);
    }
  }

  const provinceCode = out.provinceCode;
  if (provinceCode && slice.city?.trim()) {
    const cityHit = getMunicipalitiesByProvince(provinceCode).find((m) => namesMatch(m.name, slice.city ?? ""));
    if (cityHit) {
      out.municipalityCode = cityHit.psgcCode;
      out.city = cityHit.name;
    }
  }

  const municipalityCode = out.municipalityCode;
  if (municipalityCode && slice.barangay?.trim()) {
    const barangayHit = getBarangaysByMunicipality(municipalityCode).find((b) => namesMatch(b.name, slice.barangay ?? ""));
    if (barangayHit) {
      out.barangayCode = barangayHit.psgcCode;
      out.barangay = barangayHit.name;
    }
  }

  return out;
}

export type ParsedPersonalInfoOcr = {
  fields: Partial<CreateProfileFormState>;
  filledCount: number;
  source: "structured" | "text" | "merged";
};

function strField(raw: unknown): string {
  if (raw == null) return "";
  return cleanValue(String(raw));
}

function countFilled(fields: Partial<CreateProfileFormState>): number {
  return Object.entries(fields).filter(([k, v]) => {
    if (k === "noMiddleName") return v === true;
    if (typeof v === "string") return v.trim() !== "";
    return false;
  }).length;
}

function finalizeFields(fields: Partial<CreateProfileFormState>): Partial<CreateProfileFormState> {
  const addressResolved = resolvePhAddressCodes({
    region: fields.region ?? "",
    province: fields.province ?? "",
    city: fields.city ?? "",
    barangay: fields.barangay ?? "",
    zip: fields.zip ?? "",
  });
  return { ...fields, ...addressResolved };
}

function pickNameParts(raw: Record<string, unknown>) {
  let lastName = strField(raw.lastName);
  let firstName = strField(raw.firstName);
  let middleName = strField(raw.middleName);

  const full = strField(raw.fullName ?? raw.name ?? raw.patientName);
  if (full && (!lastName || !firstName)) {
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length >= 3 && !middleName) {
      lastName = lastName || parts[parts.length - 1];
      firstName = firstName || parts[0];
      middleName = middleName || parts.slice(1, -1).join(" ");
    } else if (parts.length === 2) {
      firstName = firstName || parts[0];
      lastName = lastName || parts[1];
    }
  }

  return { lastName, firstName, middleName };
}

/** Map Mistral document_annotation JSON to create-profile fields. */
export function mapStructuredPersonalInfo(raw: Record<string, unknown>): Partial<CreateProfileFormState> {
  const fields: Partial<CreateProfileFormState> = {};
  const { lastName, firstName, middleName } = pickNameParts(raw);

  const registrationNo = strField(raw.registrationNo);
  const philhealthNo = strField(raw.philhealthNo);
  const suffix = normalizeSuffix(strField(raw.suffix));
  const noMiddleName = raw.noMiddleName === true || isEmptyMiddleName(middleName);
  const birthDate = parseBirthDate(strField(raw.birthDate));
  const ageYears = strField(raw.ageYears);
  const sex = normalizeSex(strField(raw.sex));
  const civilStatus = normalizeCivilStatus(strField(raw.civilStatus));
  const placeOfBirth = strField(raw.placeOfBirth);
  const bloodType = normalizeBloodType(strField(raw.bloodType));
  const mobile = strField(raw.mobile);
  const email = strField(raw.email);
  const religion = normalizeReligion(strField(raw.religion));
  const scPwdId = strField(raw.scPwdId);
  const telephone = strField(raw.telephone);
  const street = strField(raw.street);

  if (registrationNo) fields.registrationNo = registrationNo;
  if (philhealthNo) fields.philhealthNo = philhealthNo;
  if (lastName) fields.lastName = lastName;
  if (firstName) fields.firstName = firstName;
  if (noMiddleName) {
    fields.noMiddleName = true;
    fields.middleName = "";
  } else if (middleName) {
    fields.middleName = middleName;
    fields.noMiddleName = false;
  }
  if (suffix) fields.suffix = suffix;
  if (birthDate) fields.birthDate = birthDate;
  if (ageYears && looksLikeAge(ageYears)) fields.ageYears = ageYears;
  if (sex) fields.sex = sex;
  if (civilStatus) fields.civilStatus = civilStatus;
  if (placeOfBirth) fields.placeOfBirth = placeOfBirth;
  if (bloodType && looksLikeBloodType(bloodType)) fields.bloodType = bloodType;
  if (mobile) fields.mobile = mobile;
  if (email) fields.email = email;
  if (religion) fields.religion = religion;
  if (scPwdId) fields.scPwdId = scPwdId;
  if (telephone) fields.telephone = telephone;
  if (street) fields.street = street;

  const region = strField(raw.region);
  const province = strField(raw.province);
  const city = strField(raw.city);
  const barangay = strField(raw.barangay);
  const zip = strField(raw.zip);
  if (region) fields.region = region;
  if (province) fields.province = province;
  if (city) fields.city = city;
  if (barangay) fields.barangay = barangay;
  if (zip) fields.zip = zip;

  return finalizeFields(fields);
}

function collectPairsFromText(text: string): Array<[PersonalFieldKey, string]> {
  const tableRows = parseMarkdownTableRows(text);
  const seen = new Set<PersonalFieldKey>();
  const pairs: Array<[PersonalFieldKey, string]> = [];

  const addLabelPairs = (items: Array<[string, string]>) => {
    for (const [label, value] of items) {
      const field = fieldForLabel(label);
      if (!field || seen.has(field)) continue;
      if (!valueMatchesField(field, value)) continue;
      seen.add(field);
      pairs.push([field, value]);
    }
  };

  const addFieldPairs = (items: Array<[PersonalFieldKey, string]>) => {
    for (const [field, value] of items) {
      if (seen.has(field)) continue;
      if (!valueMatchesField(field, value)) continue;
      seen.add(field);
      pairs.push([field, value]);
    }
  };

  addLabelPairs(parseLabelValueLines(text));
  addLabelPairs(parseLabelNextLine(text));
  addLabelPairs(parseLabelRowValueRow(tableRows));
  addLabelPairs(parseVerticalPairs(tableRows));
  for (const row of tableRows) addLabelPairs(pairsFromRow(row));
  addFieldPairs(parseInlineLabelRegex(text));

  return pairs;
}

/** Fallback: parse markdown/table OCR text when structured JSON is unavailable. */
export function parsePersonalInfoFromOcr(fullText: string): Partial<CreateProfileFormState> {
  const fields: Partial<CreateProfileFormState> = {};
  if (!fullText?.trim()) return fields;

  const text = fullText.replace(/<table[^>]*>/gi, "\n").replace(/<\/tr>/gi, "\n").replace(/<[^>]+>/g, " ");
  for (const [field, value] of collectPairsFromText(text)) {
    setFieldValue(fields, field, value);
  }

  if (/no\s*middle\s*name/i.test(text)) {
    fields.noMiddleName = true;
    if (!fields.middleName) fields.middleName = "";
  }

  return finalizeFields(fields);
}

function mergeFieldMaps(
  structured: Partial<CreateProfileFormState>,
  text: Partial<CreateProfileFormState>,
): Partial<CreateProfileFormState> {
  const out: Partial<CreateProfileFormState> = { ...text };
  for (const [key, value] of Object.entries(structured) as Array<[keyof CreateProfileFormState, unknown]>) {
    if (value == null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (key === "noMiddleName" && value === false) continue;

    const textVal = text[key as keyof typeof text];
    const preferTextForName =
      (key === "lastName" || key === "firstName" || key === "middleName") &&
      typeof textVal === "string" &&
      textVal.trim() !== "" &&
      (typeof value !== "string" || !looksLikePersonName(String(value)));

    if (preferTextForName) {
      out[key] = textVal as never;
      continue;
    }

    out[key as keyof CreateProfileFormState] = value as never;
  }

  for (const [key, value] of Object.entries(text) as Array<[keyof CreateProfileFormState, unknown]>) {
    if (value == null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    const existing = out[key];
    if (existing == null || (typeof existing === "string" && existing.trim() === "")) {
      out[key] = value as never;
    }
  }

  return finalizeFields(out);
}

export function extractPersonalInfoFromOcr(input: {
  personalInfo?: Record<string, unknown> | null;
  fullText?: string;
}): ParsedPersonalInfoOcr {
  const fromText = parsePersonalInfoFromOcr(input.fullText ?? "");
  const fromStructured =
    input.personalInfo && typeof input.personalInfo === "object"
      ? mapStructuredPersonalInfo(input.personalInfo)
      : {};

  const hasStructured = countFilled(fromStructured) > 0;
  const hasText = countFilled(fromText) > 0;

  if (hasStructured && hasText) {
    const merged = mergeFieldMaps(fromStructured, fromText);
    return { fields: merged, filledCount: countFilled(merged), source: "merged" };
  }
  if (hasStructured) {
    return { fields: fromStructured, filledCount: countFilled(fromStructured), source: "structured" };
  }
  return { fields: fromText, filledCount: countFilled(fromText), source: "text" };
}

export function mergeOcrIntoForm(
  current: CreateProfileFormState,
  extracted: Partial<CreateProfileFormState>,
): CreateProfileFormState {
  const next = { ...current };
  for (const [key, value] of Object.entries(extracted) as Array<[keyof CreateProfileFormState, unknown]>) {
    if (value == null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (key === "noMiddleName" && value === false) continue;
    (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

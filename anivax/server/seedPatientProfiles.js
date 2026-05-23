/**
 * Complete create-profile payloads (personal info, uploads, parent/guardian).
 * Used by seed script and kept in sync with CreateProfilePage fields.
 */

export const PH_ADDRESS_MORONG = {
  regionCode: "0300000000",
  region: "Region III (Central Luzon)",
  provinceCode: "0300800000",
  province: "Bataan",
  municipalityCode: "0300808000",
  city: "Morong",
  barangayCode: "0300808005",
  barangay: "Sabang",
  zip: "2108",
};

export const PH_ADDRESS_BALANGA = {
  regionCode: "0300000000",
  region: "Region III (Central Luzon)",
  provinceCode: "0300800000",
  province: "Bataan",
  municipalityCode: "0300803000",
  city: "Balanga",
  barangayCode: "0300803002",
  barangay: "Poblacion",
  zip: "2100",
};

function joinAddress(parts) {
  return parts
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

export function buildForm(formInput) {
  const addr = formInput.address ?? PH_ADDRESS_MORONG;
  return {
    philhealthNo: formInput.philhealthNo,
    lastName: formInput.lastName,
    firstName: formInput.firstName,
    middleName: formInput.middleName,
    suffix: formInput.suffix,
    noMiddleName: formInput.noMiddleName ?? false,
    birthDate: formInput.birthDate,
    ageYears: formInput.ageYears,
    sex: formInput.sex,
    civilStatus: formInput.civilStatus,
    placeOfBirth: formInput.placeOfBirth,
    bloodType: formInput.bloodType,
    mobile: formInput.mobile,
    email: formInput.email,
    religion: formInput.religion,
    scPwdId: formInput.scPwdId,
    telephone: formInput.telephone,
    street: formInput.street,
    registrationNo: formInput.registrationNo,
    ...addr,
  };
}

/**
 * @param {object} g
 */
export function buildGuardian(g) {
  const addr = g.address ?? PH_ADDRESS_MORONG;
  return {
    lastName: g.lastName,
    firstName: g.firstName,
    middleName: g.middleName,
    suffix: g.suffix ?? "",
    noMiddleName: g.noMiddleName ?? false,
    birthDate: g.birthDate,
    ageYears: g.ageYears,
    sex: g.sex,
    relationship: g.relationship,
    mobile: g.mobile,
    email: g.email,
    placeOfBirth: g.placeOfBirth,
    similarAddress: g.similarAddress ?? false,
    street: g.street,
    ...addr,
  };
}

export function buildProfile({ form, guardian, uploads }) {
  return {
    form: buildForm(form),
    guardian: buildGuardian(guardian),
    uploads: {
      idType: uploads.idType,
      front: {
        fileName: uploads.front?.fileName ?? uploads.fileName ?? "",
        fileId: uploads.front?.fileId ?? uploads.fileId ?? null,
      },
      back: {
        fileName: uploads.back?.fileName ?? "",
        fileId: uploads.back?.fileId ?? null,
      },
    },
  };
}

export function profileToPatientRow(id, profile) {
  const f = profile.form;
  const sex = f.sex === "MALE" ? "M" : "F";
  const suffix = f.suffix?.trim() ? f.suffix.trim() : "NONE";
  const middleName = f.noMiddleName ? null : f.middleName?.trim() || null;
  const ageYears = Number.parseInt(f.ageYears, 10);
  const address = joinAddress([f.street, f.barangay, f.city, f.province, f.region, f.zip]);

  return {
    id,
    first_name: f.firstName.trim(),
    middle_name: middleName,
    last_name: f.lastName.trim(),
    suffix,
    birth_date: f.birthDate,
    sex,
    age_years: Number.isFinite(ageYears) ? ageYears : null,
    address: address || null,
    contact_number: f.mobile.trim() || null,
    blood_type: f.bloodType,
    registration_no: f.registrationNo.trim() || null,
    profile_json: JSON.stringify(profile),
  };
}

/** Demo patients with every create-profile field populated. */
export const COMPLETE_PATIENT_SEEDS = [
  {
    id: "p_001",
    registeredAt: "2024-03-12",
    profile: buildProfile({
      form: {
        philhealthNo: "12-345678901-2",
        firstName: "Jade",
        middleName: "Reyes",
        lastName: "Salas",
        suffix: "JR.",
        birthDate: "1998-03-15",
        ageYears: "28",
        sex: "FEMALE",
        civilStatus: "SINGLE",
        placeOfBirth: "Balanga, Bataan",
        bloodType: "O+",
        mobile: "09171234501",
        email: "jade.salas@email.ph",
        religion: "ROMAN CATHOLIC",
        scPwdId: "",
        telephone: "(047) 237-1001",
        street: "123 Rizal Street",
        registrationNo: "REG-2024-0001",
        address: PH_ADDRESS_MORONG,
      },
      guardian: {
        lastName: "Salas",
        firstName: "Elena",
        middleName: "Cruz",
        suffix: "",
        birthDate: "1972-08-20",
        ageYears: "53",
        sex: "FEMALE",
        relationship: "MOTHER",
        mobile: "09181234501",
        email: "elena.salas@email.ph",
        placeOfBirth: "Orani, Bataan",
        similarAddress: true,
        street: "123 Rizal Street",
        address: PH_ADDRESS_MORONG,
      },
      uploads: {
        idType: "NATIONAL ID",
        front: { fileName: "jade-salas-national-id-front.jpg" },
        back: { fileName: "jade-salas-national-id-back.jpg" },
      },
    }),
  },
  {
    id: "p_002",
    registeredAt: "2024-05-08",
    profile: buildProfile({
      form: {
        philhealthNo: "12-987654321-0",
        firstName: "Anna Sofia",
        middleName: "Lopez",
        lastName: "Macapagal",
        suffix: "",
        birthDate: "2001-11-02",
        ageYears: "24",
        sex: "FEMALE",
        civilStatus: "SINGLE",
        placeOfBirth: "Morong, Bataan",
        bloodType: "A+",
        mobile: "09171234502",
        email: "anna.macapagal@email.ph",
        religion: "CHRISTIAN",
        scPwdId: "",
        telephone: "(047) 237-1002",
        street: "45 Mabini Avenue",
        registrationNo: "REG-2024-0002",
        address: PH_ADDRESS_MORONG,
      },
      guardian: {
        lastName: "Macapagal",
        firstName: "Roberto",
        middleName: "Dizon",
        suffix: "SR.",
        birthDate: "1968-01-30",
        ageYears: "58",
        sex: "MALE",
        relationship: "FATHER",
        mobile: "09191234502",
        email: "roberto.macapagal@email.ph",
        placeOfBirth: "Hermosa, Bataan",
        similarAddress: false,
        street: "12 Aguinaldo Drive",
        address: PH_ADDRESS_BALANGA,
      },
      uploads: {
        idType: "PHILHEALTH ID",
        front: { fileName: "anna-macapagal-philhealth-front.pdf" },
        back: { fileName: "anna-macapagal-philhealth-back.pdf" },
      },
    }),
  },
  {
    id: "p_003",
    registeredAt: "2024-07-19",
    profile: buildProfile({
      form: {
        philhealthNo: "12-112233445-5",
        firstName: "Anna",
        middleName: "Marie",
        lastName: "Vivi",
        suffix: "II",
        birthDate: "1995-06-28",
        ageYears: "30",
        sex: "FEMALE",
        civilStatus: "MARRIED",
        placeOfBirth: "Manila City",
        bloodType: "B+",
        mobile: "09171234503",
        email: "anna.vivi@email.ph",
        religion: "ROMAN CATHOLIC",
        scPwdId: "PWD-2023-8841",
        telephone: "(02) 8123-4567",
        street: "78 Bonifacio Road",
        registrationNo: "REG-2024-0003",
        address: PH_ADDRESS_MORONG,
      },
      guardian: {
        lastName: "Vivi",
        firstName: "Carlos",
        middleName: "Santos",
        suffix: "",
        birthDate: "1993-09-14",
        ageYears: "32",
        sex: "MALE",
        relationship: "OTHER",
        mobile: "09181234503",
        email: "carlos.vivi@email.ph",
        placeOfBirth: "Quezon City",
        similarAddress: true,
        street: "78 Bonifacio Road",
        address: PH_ADDRESS_MORONG,
      },
      uploads: {
        idType: "DRIVER'S LICENSE",
        front: { fileName: "anna-vivi-drivers-license-front.jpg" },
        back: { fileName: "" },
      },
    }),
  },
  {
    id: "p_1778822813496_41638011",
    registeredAt: "2025-11-14",
    profile: buildProfile({
      form: {
        philhealthNo: "12-556677889-1",
        firstName: "Maria",
        middleName: "Clara",
        lastName: "Santos",
        suffix: "",
        birthDate: "1988-12-05",
        ageYears: "37",
        sex: "FEMALE",
        civilStatus: "MARRIED",
        placeOfBirth: "Olongapo City",
        bloodType: "AB+",
        mobile: "09171234504",
        email: "maria.santos@email.ph",
        religion: "IGLESIA",
        scPwdId: "",
        telephone: "(047) 237-1004",
        street: "9 Sampaguita Lane",
        registrationNo: "REG-2025-0104",
        address: PH_ADDRESS_BALANGA,
      },
      guardian: {
        lastName: "Santos",
        firstName: "Ricardo",
        middleName: "Garcia",
        suffix: "III",
        birthDate: "1985-04-22",
        ageYears: "41",
        sex: "MALE",
        relationship: "OTHER",
        mobile: "09191234504",
        email: "ricardo.santos@email.ph",
        placeOfBirth: "Angeles City",
        similarAddress: false,
        street: "22 Narra Street",
        address: PH_ADDRESS_BALANGA,
      },
      uploads: {
        idType: "PASSPORT",
        front: { fileName: "maria-santos-passport-front.pdf" },
        back: { fileName: "maria-santos-passport-back.pdf" },
      },
    }),
  },
];

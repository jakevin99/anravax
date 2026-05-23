import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAllRegions,
  getBarangaysByMunicipality,
  getMunicipalitiesByProvince,
  getProvincesByRegion,
} from "@aivangogh/ph-address";

const addrLabelClass = "mb-1 block text-[11px] font-semibold tracking-wide text-anivax-muted";

const addrSelectClass =
  "create-profile-input box-border h-[25px] w-full rounded border border-[#D9D9D9] bg-white px-2.5 text-[13px] font-semibold text-anivax-ink outline-none transition-[box-shadow,border-color,opacity] focus:border-anivax-teal focus:ring-2 focus:ring-anivax-teal/20 disabled:opacity-60";

export type PhAddressFormSlice = {
  regionCode: string;
  region: string;
  provinceCode: string;
  province: string;
  municipalityCode: string;
  city: string;
  barangayCode: string;
  barangay: string;
  zip: string;
};

/** Default: Region III — Bataan — Morong — Sabang (PSGC). */
export const DEFAULT_PH_ADDRESS: PhAddressFormSlice = {
  regionCode: "0300000000",
  region: "Region III",
  provinceCode: "0300800000",
  province: "Bataan",
  municipalityCode: "0300808000",
  city: "Morong",
  barangayCode: "0300808005",
  barangay: "Sabang",
  zip: "",
};

function regionLabel(r: { name: string; designation: string }) {
  const d = r.designation?.trim();
  if (!d || d === r.name) return r.name;
  return `${r.name} (${d})`;
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden>
      <path d="M5 7l5 6 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Custom listbox opens below the trigger (native OS selects often flip upward
 * when the field sits low in the viewport).
 */
function ListboxSelect({
  label,
  required,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (code: string) => void;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="min-w-0" ref={rootRef}>
      <span className={addrLabelClass}>
        {label}
        {required ? <span className="ml-1 text-anivax-danger">*</span> : null}
      </span>
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => !disabled && setOpen((o) => !o)}
          className={`${addrSelectClass} flex w-full cursor-pointer items-center justify-between gap-1 pr-2 text-left transition-shadow hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <span className="min-w-0 flex-1 truncate font-semibold">{value ? selectedLabel : "Select…"}</span>
          <ChevronDown className="pointer-events-none h-5 w-5 shrink-0 opacity-70" />
        </button>
        {open ? (
          <ul
            role="listbox"
            className="absolute left-0 right-0 top-full z-[100] mt-0.5 max-h-[min(240px,45vh)] overflow-y-auto rounded border border-[#D9D9D9] bg-white py-0.5 shadow-md"
          >
            <li role="presentation">
              <button
                type="button"
                role="option"
                className="w-full px-2.5 py-1.5 text-left text-[13px] font-semibold text-anivax-muted hover:bg-anivax-page"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                Select…
              </button>
            </li>
            {options.map((o) => (
              <li key={o.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={`w-full px-2.5 py-1.5 text-left text-[13px] font-semibold hover:bg-anivax-page ${o.value === value ? "bg-anivax-teal/12 text-anivax-teal" : "text-anivax-ink"}`}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

type Props = {
  street: string;
  onStreetChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  value: PhAddressFormSlice;
  onChange: (next: PhAddressFormSlice) => void;
};

export function PhilippineAddressBlock({ street, onStreetChange, value, onChange }: Props) {
  const regions = useMemo(() => getAllRegions(), []);
  const regionOptions = useMemo(
    () => regions.map((r) => ({ value: r.psgcCode, label: regionLabel(r) })),
    [regions],
  );

  const provinces = useMemo(
    () => (value.regionCode ? getProvincesByRegion(value.regionCode) : []),
    [value.regionCode],
  );
  const provinceOptions = useMemo(
    () => provinces.map((p) => ({ value: p.psgcCode, label: p.name })),
    [provinces],
  );

  const municipalities = useMemo(
    () => (value.provinceCode ? getMunicipalitiesByProvince(value.provinceCode) : []),
    [value.provinceCode],
  );
  const municipalityOptions = useMemo(
    () => municipalities.map((m) => ({ value: m.psgcCode, label: m.name })),
    [municipalities],
  );

  const barangays = useMemo(
    () => (value.municipalityCode ? getBarangaysByMunicipality(value.municipalityCode) : []),
    [value.municipalityCode],
  );
  const barangayOptions = useMemo(
    () => barangays.map((b) => ({ value: b.psgcCode, label: b.name })),
    [barangays],
  );

  const setRegion = (regionCode: string) => {
    if (!regionCode) {
      onChange({
        ...value,
        regionCode: "",
        region: "",
        provinceCode: "",
        province: "",
        municipalityCode: "",
        city: "",
        barangayCode: "",
        barangay: "",
      });
      return;
    }
    const r = regions.find((x) => x.psgcCode === regionCode);
    onChange({
      ...value,
      regionCode,
      region: r?.name ?? "",
      provinceCode: "",
      province: "",
      municipalityCode: "",
      city: "",
      barangayCode: "",
      barangay: "",
    });
  };

  const setProvince = (provinceCode: string) => {
    if (!provinceCode) {
      onChange({
        ...value,
        provinceCode: "",
        province: "",
        municipalityCode: "",
        city: "",
        barangayCode: "",
        barangay: "",
      });
      return;
    }
    const p = provinces.find((x) => x.psgcCode === provinceCode);
    onChange({
      ...value,
      provinceCode,
      province: p?.name ?? "",
      municipalityCode: "",
      city: "",
      barangayCode: "",
      barangay: "",
    });
  };

  const setMunicipality = (municipalityCode: string) => {
    if (!municipalityCode) {
      onChange({
        ...value,
        municipalityCode: "",
        city: "",
        barangayCode: "",
        barangay: "",
      });
      return;
    }
    const m = municipalities.find((x) => x.psgcCode === municipalityCode);
    onChange({
      ...value,
      municipalityCode,
      city: m?.name ?? "",
      barangayCode: "",
      barangay: "",
    });
  };

  const setBarangay = (barangayCode: string) => {
    if (!barangayCode) {
      onChange({ ...value, barangayCode: "", barangay: "" });
      return;
    }
    const b = barangays.find((x) => x.psgcCode === barangayCode);
    onChange({ ...value, barangayCode, barangay: b?.name ?? "" });
  };

  const inputFieldClass =
    "create-profile-input box-border h-[25px] w-full rounded border border-[#D9D9D9] bg-white px-2.5 text-[13px] font-semibold text-anivax-ink outline-none transition-[box-shadow,border-color,opacity] focus:border-anivax-teal focus:ring-2 focus:ring-anivax-teal/20 disabled:opacity-60";

  return (
    <>
      <div className="addr-street-grid mb-3 grid grid-cols-[minmax(0,1fr)_200px] items-start gap-3">
        <div className="min-w-0">
          <span className={addrLabelClass}>
            HOUSE NO./ STREET/ SUBDIVISION
            <span className="ml-1 text-anivax-danger">*</span>
          </span>
          <input
            type="text"
            value={street}
            onChange={onStreetChange}
            className={`${inputFieldClass} min-w-0`}
          />
        </div>
        <ListboxSelect
          label="REGION"
          required
          value={value.regionCode}
          onChange={setRegion}
          options={regionOptions}
        />
      </div>

      <div className="addr-grid grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_136px] items-start gap-3">
        <ListboxSelect
          label="PROVINCE"
          required
          value={value.provinceCode}
          onChange={setProvince}
          options={provinceOptions}
          disabled={!value.regionCode}
        />
        <ListboxSelect
          label="CITY/MUNICIPALITY"
          required
          value={value.municipalityCode}
          onChange={setMunicipality}
          options={municipalityOptions}
          disabled={!value.provinceCode}
        />
        <ListboxSelect
          label="BARANGAY"
          required
          value={value.barangayCode}
          onChange={setBarangay}
          options={barangayOptions}
          disabled={!value.municipalityCode}
        />
        <div className="min-w-0">
          <span className={addrLabelClass}>ZIP CODE</span>
          <input
            type="text"
            inputMode="numeric"
            value={value.zip}
            onChange={(e) => onChange({ ...value, zip: e.target.value })}
            className={inputFieldClass}
          />
        </div>
      </div>
    </>
  );
}

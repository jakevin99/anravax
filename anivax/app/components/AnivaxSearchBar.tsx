/**
 * Shared header search field for queue and records routes.
 * Pill shape, sky/teal accents, icon-in-field layout.
 */

export interface AnivaxSearchBarProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Accessible name for the input (required). */
  ariaLabel: string;
  placeholder?: string;
  className?: string;
}

export default function AnivaxSearchBar({
  value,
  onChange,
  ariaLabel,
  placeholder = "Search by last name…",
  className = "",
}: AnivaxSearchBarProps) {
  return (
    <div
      className={`group relative flex w-full max-w-[360px] items-center ${className}`.trim()}
    >
      <span
        className="pointer-events-none absolute left-3.5 flex h-5 w-5 items-center justify-center text-anivax-teal/80 transition-colors group-focus-within:text-anivax-teal"
        aria-hidden
      >
        <SearchIcon />
      </span>
      <input
        type="text"
        role="searchbox"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
        className="box-border h-11 w-full rounded-xl border border-anivax-border/50 bg-white py-2.5 pl-11 pr-10 text-sm font-medium text-anivax-ink shadow-anivax-card outline-none transition-[border-color,box-shadow] placeholder:font-normal placeholder:text-anivax-muted/90 hover:border-anivax-teal/35 focus:border-anivax-teal focus:shadow-[0_0_0_3px_rgb(0_151_157/0.12)] focus:ring-0"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange({
              target: { value: "" },
              currentTarget: { value: "" },
            } as React.ChangeEvent<HTMLInputElement>);
          }}
          className="absolute right-2.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-anivax-muted transition-colors hover:bg-anivax-sky/40 hover:text-anivax-teal"
          aria-label="Clear search"
        >
          <ClearIcon />
        </button>
      ) : null}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path
        d="M16 16l5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

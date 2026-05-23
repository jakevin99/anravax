import type { ReactNode } from "react";

export function SectionTag({ label }: { label: string }) {
  return (
    <div className="relative py-0 pl-1 pr-2.5">
      <div className="absolute left-0 right-0 top-1/2 z-0 h-[22px] -translate-y-[30%] bg-white" />
      <h2 className="relative z-[1] m-0 text-[17px] font-extrabold leading-snug tracking-wide text-anivax-green-ring">{label}</h2>
    </div>
  );
}

function AccordionChevron({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={className ?? "h-5 w-5 shrink-0 text-anivax-ink"}
      aria-hidden="true"
    >
      <path d="M5 7l5 6 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Same pattern as UPLOADS / PARENT'S INFORMATION on Create profile: `border-4` teal shell,
 * collapsed header with large title + chevron, expanded header uses {@link SectionTag}.
 */
export function AccordionCard({
  title,
  open,
  onToggle,
  className,
  children,
  contentClassName,
  centerDivider,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  className?: string;
  children?: ReactNode;
  contentClassName?: string;
  centerDivider?: boolean;
}) {
  return (
    <div
      className={`relative box-border rounded-[10px] border-4 border-anivax-teal bg-white ${open ? "pt-2.5" : "pt-0"} ${className ?? ""}`}
    >
      {open && centerDivider ? (
        <div className="pointer-events-none absolute bottom-0 left-1/2 top-0 z-[1] w-[3px] -translate-x-[1.5px] bg-anivax-teal" />
      ) : null}
      {open ? (
        <div className="absolute left-[18px] top-[-16px] z-[2]">
          <SectionTag label={title} />
        </div>
      ) : null}
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full cursor-pointer items-center justify-between border-none bg-transparent text-left transition-colors hover:bg-anivax-page/40 ${
          open ? "px-5 pb-1.5 pt-2.5" : "px-4 py-3"
        }`}
      >
        {!open ? (
          <span className="text-[22px] font-extrabold tracking-wide text-anivax-green-ring">{title}</span>
        ) : (
          <span />
        )}
        <AccordionChevron className={`h-7 w-7 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className={`px-6 pb-5 pt-0.5 text-sm font-semibold text-anivax-muted ${contentClassName ?? ""}`}>{children}</div>
      ) : null}
    </div>
  );
}

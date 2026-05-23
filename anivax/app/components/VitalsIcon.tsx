type VitalsIconProps = {
  /** ECG line color. On USER VITALS button use the same teal as the button fill. */
  ecgStroke?: string;
};

/**
 * Heart + ECG pulse — queue table uses white ECG; profile USER VITALS uses button teal on the trace.
 */
export default function VitalsIcon({ ecgStroke = "#FFFFFF" }: VitalsIconProps) {
  return (
    <svg width="22" height="20" viewBox="0 0 24 22" fill="none" aria-hidden="true">
      <path
        d="M12 21.3l-1.45-1.32C5.4 15.32 2 12.24 2 8.46 2 5.38 4.42 2.96 7.5 2.96c1.74 0 3.41.81 4.5 2.09 1.09-1.28 2.76-2.09 4.5-2.09 3.08 0 5.5 2.42 5.5 5.5 0 3.78-3.4 6.86-8.55 11.52L12 21.3z"
        fill="#E53E5C"
      />
      <path
        d="M3.5 11h3l1.7-3.2 2.4 6.4 1.6-4 1.2 1.8h6.1"
        stroke={ecgStroke}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

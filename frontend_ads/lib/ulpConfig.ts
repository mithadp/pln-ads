/**
 * Single source of truth for ULP (Unit Layanan Pelanggan) identity:
 * code → human label + brand colors. Used across Anomalies, Forecast,
 * Dashboard, and Upload Logs.
 */

export interface ULPColor {
  text: string
  bg: string
  border: string
}

export const ULP_MAP: Record<string, string> = {
  '51101': 'ULP Indrapura',
  '51102': 'ULP Ploso',
  '51103': 'ULP Tandes',
  '51104': 'ULP Perak',
  '51105': 'ULP Kenjeran',
  '51106': 'ULP Embong Wungu',
}

export const ULP_COLORS: Record<string, ULPColor> = {
  '51101': { text: '#1D4ED8', bg: '#EFF6FF', border: '#BFDBFE' }, // blue
  '51102': { text: '#15803D', bg: '#F0FDF4', border: '#BBF7D0' }, // green
  '51103': { text: '#C2410C', bg: '#FFF7ED', border: '#FED7AA' }, // orange
  '51104': { text: '#7E22CE', bg: '#FDF4FF', border: '#E9D5FF' }, // purple
  '51105': { text: '#BE123C', bg: '#FFF1F2', border: '#FECDD3' }, // rose
  '51106': { text: '#0F766E', bg: '#F0FDFA', border: '#99F6E4' }, // teal
}

/** Stable fallback for unknown / future ULP codes. */
export const FALLBACK_COLOR: ULPColor = { text: '#374151', bg: '#F9FAFB', border: '#E5E7EB' }

export function getULPName(unitup: string): string {
  return ULP_MAP[unitup] ?? `ULP ${unitup}`
}

export function getULPColor(unitup: string): ULPColor {
  return ULP_COLORS[unitup] ?? FALLBACK_COLOR
}

/** Ordered list of known ULP codes — handy for rendering filter pills. */
export const ULP_CODES: readonly string[] = Object.keys(ULP_MAP)

/** Dropdown options (with "All" sentinel) shared with Forecast tab. */
export const ULP_OPTIONS: readonly { code: string; label: string }[] = [
  { code: '', label: 'Semua Unit (All Locations)' },
  ...ULP_CODES.map((code) => ({ code, label: getULPName(code) })),
]

/** Formats an ISO date for display. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

/** "Ada Lovelace" -> "A. Lovelace" */
export function formatName(fullName: string): string {
  const [first = '', ...rest] = fullName.split(' ');
  if (rest.length === 0) return fullName;
  return `${first.charAt(0)}. ${rest.join(' ')}`;
}

/** DEAD CODE (intentional): old CSV exporter helper, unreferenced. */
export function toCsvRow(values: string[]): string {
  return values.map((v) => `"${v.replaceAll('"', '""')}"`).join(',');
}

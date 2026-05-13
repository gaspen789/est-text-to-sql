/**
 * Pastel chip Tailwind classes — same palette as modality chips
 * (model table, modalities section).
 */
export const PASTEL_CHIP_CLASSNAMES: readonly string[] = [
  'bg-pink-100 text-pink-800 dark:bg-pink-950/50 dark:text-pink-200',
  'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200',
  'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-200',
  'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-200',
  'bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-200',
  'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-950/50 dark:text-teal-200',
  'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200',
  'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
];

export const PASTEL_CHIP_FALLBACK_CLASS = PASTEL_CHIP_CLASSNAMES[0]!;

/** Stable palette index from a seed (same scheme as user group chips). */
export function stablePastelChipIndex(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const n = PASTEL_CHIP_CLASSNAMES.length;
  return n === 0 ? 0 : h % n;
}

export function pastelChipClassForSeed(seed: string): string {
  return PASTEL_CHIP_CLASSNAMES[stablePastelChipIndex(seed)] ?? PASTEL_CHIP_FALLBACK_CLASS;
}

export type TableResourceSection = 'tables' | 'views' | 'materialized_views';

/** Maps classifier `table_type.name` to API resource grouping (GET /resources). */
export function tableTypeToResourceSection(name: string | null | undefined): TableResourceSection {
  if (name == null || name === '') return 'tables';
  const n = name.trim().toLowerCase();
  if (n === 'materialized view') return 'materialized_views';
  if (n === 'view') return 'views';
  return 'tables';
}

/** Classifier `table_type.name` values that are stored like views (not base tables). */
export function isViewLikeTableTypeName(name: string | null | undefined): boolean {
  const s = tableTypeToResourceSection(name);
  return s === 'views' || s === 'materialized_views';
}

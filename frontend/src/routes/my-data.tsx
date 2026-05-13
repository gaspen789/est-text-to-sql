import { useMemo, useState } from 'react';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, ToggleLeft, ToggleRight } from 'lucide-react';

import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { apiFetchJson, queryKeys } from '@/lib/api';

type ColumnDto = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  character_maximum_length: number | null;
  comment_for_user?: string | null;
};

type TableDto = {
  table_name: string;
  comment_for_user?: string | null;
  columns: ColumnDto[];
  column_error?: string;
};

type ViewDto = {
  view_name: string;
  comment_for_user?: string | null;
  columns: ColumnDto[];
  column_error?: string;
};

type SchemaDto = {
  schema_name: string;
  comment_for_user?: string | null;
  tables: TableDto[];
  views: ViewDto[];
};

type DatabaseDto = {
  database_id: number;
  database_name: string;
  comment_for_user?: string | null;
  schemas: SchemaDto[];
};

type DataStructureResponse = {
  databases: DatabaseDto[];
};

function ToggleActionButton(props: {
  expanded: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { expanded, disabled, title, onClick, children } = props;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      title={title}
      className="h-7 px-2 text-[12px] justify-end"
      onClick={onClick}
    >
      {expanded ? (
        <ToggleLeft className="h-4 w-4 mr-1" />
      ) : (
        <ToggleRight className="h-4 w-4 mr-1" />
      )}
      {children}
    </Button>
  );
}

function stableCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

function formatDataType(c: ColumnDto): string {
  const base = c.data_type;
  if (
    c.character_maximum_length != null &&
    Number.isFinite(Number(c.character_maximum_length)) &&
    Number(c.character_maximum_length) > 0
  ) {
    return `${base}(${c.character_maximum_length})`;
  }
  return base;
}

function ColumnListItem(props: { col: ColumnDto }) {
  const { col } = props;
  const comment = (col.comment_for_user ?? '').trim();
  return (
    <li className="text-[12px] font-mono leading-relaxed">
      <div>
        <span className="text-foreground">{col.column_name}</span>
        <span className="text-muted-foreground"> {formatDataType(col)}</span>
      </div>
      {comment ? (
        <div className="text-[11px] text-muted-foreground whitespace-pre-wrap mt-0.5 font-sans">
          {comment}
        </div>
      ) : null}
    </li>
  );
}

export const Route = createFileRoute('/my-data')({
  beforeLoad: () => {
    const isAuthenticated = sessionStorage.getItem('isAuthenticated') === 'true';
    if (!isAuthenticated) {
      throw redirect({ to: '/login' as any });
    }
  },
  component: MyDataPage,
});

function MyDataPage() {
  const { t } = useTranslation();

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.myDataStructure,
    queryFn: () => apiFetchJson<DataStructureResponse>('/api/me/data-structure'),
  });

  const sortedDatabases = useMemo(
    () =>
      data?.databases
        ? [...data.databases].sort((a, b) => stableCompare(a.database_name, b.database_name))
        : [],
    [data?.databases]
  );

  const [databaseOpen, setDatabaseOpen] = useState<Record<number, boolean>>({});
  const [schemaOpen, setSchemaOpen] = useState<Record<string, boolean>>({});
  const [tableOpen, setTableOpen] = useState<Record<string, boolean>>({});
  const [viewOpen, setViewOpen] = useState<Record<string, boolean>>({});

  const isDatabaseExpanded = (dbId: number) => databaseOpen[dbId] ?? true;
  const schemaKey = (dbId: number, schemaName: string) => `${dbId}:${schemaName}`;
  const tableKey = (dbId: number, schemaName: string, tableName: string) =>
    `${dbId}:${schemaName}:${tableName}`;
  const viewKey = (dbId: number, schemaName: string, viewName: string) =>
    `${dbId}:${schemaName}:view:${viewName}`;

  const isDbTreeFullyExpanded = (db: DatabaseDto) =>
    isDatabaseExpanded(db.database_id) &&
    db.schemas.length > 0 &&
    db.schemas.every((s) => {
      const sk = schemaKey(db.database_id, s.schema_name);
      if (schemaOpen[sk] !== true) return false;
      const tablesOk =
        s.tables.length === 0 ||
        s.tables.every(
          (tb) => tableOpen[tableKey(db.database_id, s.schema_name, tb.table_name)] === true
        );
      const viewsOk =
        (s.views ?? []).length === 0 ||
        (s.views ?? []).every(
          (v) => viewOpen[viewKey(db.database_id, s.schema_name, v.view_name)] === true
        );
      return tablesOk && viewsOk;
    });

  const tablesAllExpandedForSchema = (db: DatabaseDto, sch: SchemaDto) => {
    const dbId = db.database_id;
    if (sch.tables.length === 0) return true;
    return sch.tables.every(
      (tb) => tableOpen[tableKey(dbId, sch.schema_name, tb.table_name)] === true
    );
  };

  const viewsAllExpandedForSchema = (db: DatabaseDto, sch: SchemaDto) => {
    const dbId = db.database_id;
    const views = sch.views ?? [];
    if (views.length === 0) return true;
    return views.every((v) => viewOpen[viewKey(dbId, sch.schema_name, v.view_name)] === true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <PageHeader title={t('myData.title')} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          <p className="text-[13px] text-muted-foreground max-w-3xl mb-6">{t('myData.intro')}</p>
          {isLoading && <p className="text-[13px] text-muted-foreground">{t('common.loading')}</p>}
          {error && <p className="text-[13px] text-destructive">{t('myData.loadError')}</p>}
          {!isLoading && !error && data && data.databases.length === 0 && (
            <p className="text-[13px] text-muted-foreground">{t('myData.empty')}</p>
          )}
          {!isLoading && !error && data && data.databases.length > 0 && (
            <div className="columns-1 gap-4 lg:columns-2">
              {sortedDatabases.map((db) => {
                const treeFullyExpanded = isDbTreeFullyExpanded(db);
                const dbExpanded = isDatabaseExpanded(db.database_id);
                return (
                  <div
                    key={db.database_id}
                    className="@container mb-4 break-inside-avoid rounded-lg border border-border bg-card shadow-sm p-4 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border pb-4">
                      <span className="text-[14px] font-semibold shrink-0">
                        {t('dataAccess.database')}: {db.database_name}
                      </span>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={db.schemas.length === 0}
                          title={
                            treeFullyExpanded
                              ? t('dataAccess.treeCloseAll')
                              : t('dataAccess.treeOpenAll')
                          }
                          onClick={() => {
                            const expand = !treeFullyExpanded;
                            const dbId = db.database_id;
                            setDatabaseOpen((prev) => ({ ...prev, [dbId]: expand }));
                            setSchemaOpen((prev) => {
                              const next = { ...prev };
                              for (const s of db.schemas) {
                                next[schemaKey(dbId, s.schema_name)] = expand;
                              }
                              return next;
                            });
                            setTableOpen((prev) => {
                              const next = { ...prev };
                              for (const s of db.schemas) {
                                for (const tb of s.tables) {
                                  next[tableKey(dbId, s.schema_name, tb.table_name)] = expand;
                                }
                              }
                              return next;
                            });
                            setViewOpen((prev) => {
                              const next = { ...prev };
                              for (const s of db.schemas) {
                                for (const v of s.views ?? []) {
                                  next[viewKey(dbId, s.schema_name, v.view_name)] = expand;
                                }
                              }
                              return next;
                            });
                          }}
                        >
                          {treeFullyExpanded ? (
                            <ToggleLeft className="h-4 w-4 mr-1" />
                          ) : (
                            <ToggleRight className="h-4 w-4 mr-1" />
                          )}
                          {treeFullyExpanded
                            ? t('dataAccess.treeCloseAll')
                            : t('dataAccess.treeOpenAll')}
                        </Button>
                      </div>
                    </div>
                    {!dbExpanded ? null : (db.comment_for_user ?? '').trim() ? (
                      <div className="text-[13px] text-muted-foreground whitespace-pre-wrap">
                        {(db.comment_for_user ?? '').trim()}
                      </div>
                    ) : null}

                    {!dbExpanded ? null : db.schemas.length === 0 ? (
                      <p className="text-[13px] text-muted-foreground">{t('myData.noSchemas')}</p>
                    ) : (
                      <div className="grid grid-cols-1 @[520px]:grid-cols-2 gap-2">
                        {[...db.schemas]
                          .sort((a, b) => stableCompare(a.schema_name, b.schema_name))
                          .map((sch) => {
                            const sk = schemaKey(db.database_id, sch.schema_name);
                            const schemaExpanded = schemaOpen[sk] ?? false;
                            const tablesExpanded = tablesAllExpandedForSchema(db, sch);
                            const viewsExpanded = viewsAllExpandedForSchema(db, sch);
                            const views = sch.views ?? [];

                            return (
                              <div key={sk} className="rounded-lg border border-border bg-muted/20">
                                <div className="p-3 space-y-2">
                                  <div className="flex items-start gap-2">
                                    <div className="min-w-0 flex-1">
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1 text-[13px] font-medium hover:text-foreground shrink-0"
                                        onClick={() =>
                                          setSchemaOpen((prev) => ({
                                            ...prev,
                                            [sk]: !(prev[sk] ?? false),
                                          }))
                                        }
                                      >
                                        {schemaExpanded ? (
                                          <ChevronDown className="h-4 w-4" />
                                        ) : (
                                          <ChevronRight className="h-4 w-4" />
                                        )}
                                        <span>
                                          {t('myData.schemaHeading', { name: sch.schema_name })}
                                        </span>
                                      </button>
                                      {(sch.comment_for_user ?? '').trim() ? (
                                        <div className="mt-1 text-[12px] text-muted-foreground whitespace-pre-wrap">
                                          {(sch.comment_for_user ?? '').trim()}
                                        </div>
                                      ) : null}
                                    </div>

                                    {schemaExpanded &&
                                    (sch.tables.length > 1 || views.length > 1) ? (
                                      <div className="ml-auto flex flex-col items-end gap-1 shrink-0">
                                        {sch.tables.length > 1 ? (
                                          <ToggleActionButton
                                            expanded={tablesExpanded}
                                            onClick={() => {
                                              const expand = !tablesExpanded;
                                              setTableOpen((prev) => {
                                                const next = { ...prev };
                                                for (const tb of sch.tables) {
                                                  next[
                                                    tableKey(
                                                      db.database_id,
                                                      sch.schema_name,
                                                      tb.table_name
                                                    )
                                                  ] = expand;
                                                }
                                                return next;
                                              });
                                            }}
                                          >
                                            {tablesExpanded
                                              ? t('myData.collapseTables')
                                              : t('myData.expandTables')}
                                          </ToggleActionButton>
                                        ) : null}

                                        {views.length > 1 ? (
                                          <ToggleActionButton
                                            expanded={viewsExpanded}
                                            onClick={() => {
                                              const expand = !viewsExpanded;
                                              setViewOpen((prev) => {
                                                const next = { ...prev };
                                                for (const v of views) {
                                                  next[
                                                    viewKey(
                                                      db.database_id,
                                                      sch.schema_name,
                                                      v.view_name
                                                    )
                                                  ] = expand;
                                                }
                                                return next;
                                              });
                                            }}
                                          >
                                            {viewsExpanded
                                              ? t('myData.collapseViews')
                                              : t('myData.expandViews')}
                                          </ToggleActionButton>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </div>

                                  {schemaExpanded ? (
                                    <div className="ml-6 space-y-2 border-l border-border/60 pl-3">
                                      {sch.tables.length === 0 && views.length === 0 ? (
                                        <p className="text-[13px] text-muted-foreground">
                                          {t('myData.schemaNoTables')}
                                        </p>
                                      ) : null}
                                      {sch.tables.length > 0
                                        ? [...sch.tables]
                                            .sort((a, b) =>
                                              stableCompare(a.table_name, b.table_name)
                                            )
                                            .map((tbl) => {
                                              const tk = tableKey(
                                                db.database_id,
                                                sch.schema_name,
                                                tbl.table_name
                                              );
                                              const expanded = tableOpen[tk] ?? false;
                                              return (
                                                <div key={tk} className="space-y-2">
                                                  <button
                                                    type="button"
                                                    className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
                                                    onClick={() =>
                                                      setTableOpen((prev) => ({
                                                        ...prev,
                                                        [tk]: !(prev[tk] ?? false),
                                                      }))
                                                    }
                                                  >
                                                    {expanded ? (
                                                      <ChevronDown className="h-3.5 w-3.5" />
                                                    ) : (
                                                      <ChevronRight className="h-3.5 w-3.5" />
                                                    )}
                                                    <span className="font-mono text-foreground">
                                                      {sch.schema_name}.{tbl.table_name}
                                                    </span>
                                                  </button>
                                                  {(tbl.comment_for_user ?? '').trim() ? (
                                                    <div className="text-[12px] text-muted-foreground whitespace-pre-wrap ml-6">
                                                      {(tbl.comment_for_user ?? '').trim()}
                                                    </div>
                                                  ) : null}
                                                  {expanded ? (
                                                    tbl.column_error ? (
                                                      <p className="text-[13px] text-destructive ml-9 pl-3 border-l border-border/60">
                                                        {tbl.column_error}
                                                      </p>
                                                    ) : (
                                                      <ul className="ml-9 space-y-1 border-l border-border/60 pl-3 list-none">
                                                        {tbl.columns.map((col) => (
                                                          <ColumnListItem
                                                            key={`${tbl.table_name}-${col.column_name}`}
                                                            col={col}
                                                          />
                                                        ))}
                                                      </ul>
                                                    )
                                                  ) : null}
                                                </div>
                                              );
                                            })
                                        : null}
                                      {views.length > 0 ? (
                                        <div className="mt-4 space-y-2 border-t border-border/60 pt-3">
                                          <div className="text-[11px] uppercase tracking-wide font-medium text-muted-foreground">
                                            {t('myData.viewsHeading')}
                                          </div>
                                          {[...views]
                                            .sort((a, b) => stableCompare(a.view_name, b.view_name))
                                            .map((vw) => {
                                              const vk = viewKey(
                                                db.database_id,
                                                sch.schema_name,
                                                vw.view_name
                                              );
                                              const expanded = viewOpen[vk] ?? false;
                                              return (
                                                <div key={vk} className="space-y-2">
                                                  <button
                                                    type="button"
                                                    className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
                                                    onClick={() =>
                                                      setViewOpen((prev) => ({
                                                        ...prev,
                                                        [vk]: !(prev[vk] ?? false),
                                                      }))
                                                    }
                                                  >
                                                    {expanded ? (
                                                      <ChevronDown className="h-3.5 w-3.5" />
                                                    ) : (
                                                      <ChevronRight className="h-3.5 w-3.5" />
                                                    )}
                                                    <span className="font-mono text-foreground">
                                                      {sch.schema_name}.{vw.view_name}
                                                    </span>
                                                    <span className="text-[10px] uppercase tracking-wide opacity-70">
                                                      {t('dataAccess.view')}
                                                    </span>
                                                  </button>
                                                  {(vw.comment_for_user ?? '').trim() ? (
                                                    <div className="text-[12px] text-muted-foreground whitespace-pre-wrap ml-6">
                                                      {(vw.comment_for_user ?? '').trim()}
                                                    </div>
                                                  ) : null}
                                                  {expanded ? (
                                                    vw.column_error ? (
                                                      <p className="text-[13px] text-destructive ml-9 pl-3 border-l border-border/60">
                                                        {vw.column_error}
                                                      </p>
                                                    ) : (
                                                      <ul className="ml-9 space-y-1 border-l border-border/60 pl-3 list-none">
                                                        {vw.columns.map((col) => (
                                                          <ColumnListItem
                                                            key={`${vw.view_name}-${col.column_name}`}
                                                            col={col}
                                                          />
                                                        ))}
                                                      </ul>
                                                    )
                                                  ) : null}
                                                </div>
                                              );
                                            })}
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** SQL snippets for mirroring access_right rows as read-only privileges on client DBMS instances. */

/** Replace in the script before running in production. */
export const SQL_PASSWORD_PLACEHOLDER = '__PLACEHOLDER_PASSWORD__';

export type SchemaRow = { schema_id: number; name: string };

export type GrantRowForSql = {
  resource_type: 'DATABASE' | 'SCHEMA' | 'TABLE' | 'VIEW' | 'UNKNOWN';
  database_id: number | null;
  schema_id: number | null;
  table_name: string | null;
  view_name: string | null;
};

function pgQuoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

function mysqlQuoteIdent(ident: string): string {
  return `\`${ident.replace(/`/g, '``')}\``;
}

function mysqlQuoteUser(roleName: string): string {
  return `'${roleName.replace(/'/g, "''")}'@'%'`;
}

function sqlEscapeSingleQuotedString(s: string): string {
  return s.replace(/'/g, "''");
}

function emitPasswordPlaceholderPreamble(lines: string[]): void {
  lines.push(`-- Set a real password: replace every ${SQL_PASSWORD_PLACEHOLDER} below before running.`);
  lines.push('');
}

function buildPostgresCreateLoginIfMissing(roleName: string, lines: string[]): void {
  const role = pgQuoteIdent(roleName);
  const pw = sqlEscapeSingleQuotedString(SQL_PASSWORD_PLACEHOLDER);
  lines.push(`-- Create login role if it does not already exist`);
  lines.push(`DO $$`);
  lines.push(`BEGIN`);
  lines.push(`  CREATE ROLE ${role} LOGIN PASSWORD '${pw}';`);
  lines.push(`EXCEPTION`);
  lines.push(`  WHEN duplicate_object THEN NULL;`);
  lines.push(`END`);
  lines.push(`$$;`);
  lines.push('');
}

function buildMysqlCreateUserIfMissing(roleName: string, lines: string[]): void {
  const user = mysqlQuoteUser(roleName);
  const pw = sqlEscapeSingleQuotedString(SQL_PASSWORD_PLACEHOLDER);
  lines.push(`-- Create user if missing (MySQL 8+ / MariaDB 10.1.3+)`);
  lines.push(`CREATE USER IF NOT EXISTS ${user} IDENTIFIED BY '${pw}';`);
  lines.push('');
}

function buildOracleCreateUserIfMissing(roleName: string, lines: string[]): void {
  const identQuoted = `"${roleName.replace(/"/g, '""')}"`;
  const pwOra = sqlEscapeSingleQuotedString(SQL_PASSWORD_PLACEHOLDER);
  lines.push(`-- Create database user if not present (matches ALL_USERS.USERNAME to group name)`);
  lines.push(`DECLARE`);
  lines.push(`  v_cnt NUMBER;`);
  lines.push(`BEGIN`);
  lines.push(`  SELECT COUNT(*) INTO v_cnt FROM all_users WHERE username = '${roleName.replace(/'/g, "''")}';`);
  lines.push(`  IF v_cnt = 0 THEN`);
  lines.push(
    `    EXECUTE IMMEDIATE 'CREATE USER ${identQuoted} IDENTIFIED BY ''${pwOra}''';`
  );
  lines.push(`  END IF;`);
  lines.push(`END;`);
  lines.push(`/`);
  lines.push('');
}

type EffectiveAccess = {
  fullDb: boolean;
  fullSchemaIds: Set<number>;
  relations: Map<string, { schemaId: number; name: string }>;
};

function computeEffectiveAccess(rows: GrantRowForSql[], databaseId: number): EffectiveAccess {
  let fullDb = false;
  const fullSchemaIds = new Set<number>();
  const relations = new Map<string, { schemaId: number; name: string }>();

  for (const r of rows) {
    if (r.resource_type === 'DATABASE' && r.database_id === databaseId) {
      fullDb = true;
      break;
    }
  }

  if (fullDb) {
    return { fullDb: true, fullSchemaIds: new Set(), relations: new Map() };
  }

  for (const r of rows) {
    if (r.resource_type === 'SCHEMA' && r.schema_id != null) {
      fullSchemaIds.add(r.schema_id);
    }
  }

  for (const r of rows) {
    if (r.resource_type === 'TABLE' && r.schema_id != null && r.table_name) {
      if (fullSchemaIds.has(r.schema_id)) continue;
      const key = `${r.schema_id}\0${r.table_name}`;
      relations.set(key, { schemaId: r.schema_id, name: r.table_name });
    } else if (r.resource_type === 'VIEW' && r.schema_id != null && r.view_name) {
      if (fullSchemaIds.has(r.schema_id)) continue;
      const key = `${r.schema_id}\0${r.view_name}`;
      relations.set(key, { schemaId: r.schema_id, name: r.view_name });
    }
  }

  return { fullDb: false, fullSchemaIds, relations };
}

function sortSchemas(schemas: SchemaRow[]): SchemaRow[] {
  return [...schemas].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function buildPostgresReadOnlyScript(
  roleName: string,
  databaseName: string,
  schemas: SchemaRow[],
  access: EffectiveAccess
): string {
  const role = pgQuoteIdent(roleName);
  const db = pgQuoteIdent(databaseName);
  const lines: string[] = [];

  lines.push(`-- Read-only SQL for PostgreSQL`);
  lines.push(`-- Database (catalog): ${databaseName}`);
  lines.push(`-- Role / login: ${roleName}`);
  lines.push(
    `-- Revokes privileges on all schemas registered for this database in the resource catalog, then grants SELECT (and schema USAGE) per access_right.`
  );
  emitPasswordPlaceholderPreamble(lines);
  buildPostgresCreateLoginIfMissing(roleName, lines);
  lines.push(`BEGIN;`);
  lines.push('');
  lines.push(`REVOKE ALL PRIVILEGES ON DATABASE ${db} FROM ${role};`);
  lines.push(`GRANT CONNECT ON DATABASE ${db} TO ${role};`);
  lines.push('');

  const sortedSch = sortSchemas(schemas);
  for (const s of sortedSch) {
    const qs = pgQuoteIdent(s.name);
    lines.push(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${qs} FROM ${role};`);
    lines.push(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ${qs} FROM ${role};`);
    lines.push(`REVOKE ALL ON SCHEMA ${qs} FROM ${role};`);
  }
  lines.push('');

  const schemaById = new Map(schemas.map((s) => [s.schema_id, s]));

  if (access.fullDb) {
    for (const s of sortedSch) {
      const qs = pgQuoteIdent(s.name);
      lines.push(`GRANT USAGE ON SCHEMA ${qs} TO ${role};`);
      lines.push(`GRANT SELECT ON ALL TABLES IN SCHEMA ${qs} TO ${role};`);
      lines.push(`GRANT SELECT ON ALL SEQUENCES IN SCHEMA ${qs} TO ${role};`);
    }
  } else {
    const schemaGrantIds = [...access.fullSchemaIds].sort((a, b) => a - b);
    for (const sid of schemaGrantIds) {
      const s = schemaById.get(sid);
      if (!s) continue;
      const qs = pgQuoteIdent(s.name);
      lines.push(`GRANT USAGE ON SCHEMA ${qs} TO ${role};`);
      lines.push(`GRANT SELECT ON ALL TABLES IN SCHEMA ${qs} TO ${role};`);
      lines.push(`GRANT SELECT ON ALL SEQUENCES IN SCHEMA ${qs} TO ${role};`);
    }

    const relList = [...access.relations.values()].sort((a, b) => {
      const sa = schemaById.get(a.schemaId)?.name ?? '';
      const sb = schemaById.get(b.schemaId)?.name ?? '';
      const c = sa.localeCompare(sb, undefined, { sensitivity: 'base' });
      if (c !== 0) return c;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    const usageSchemas = new Set<number>();
    for (const sid of schemaGrantIds) usageSchemas.add(sid);
    for (const rel of relList) usageSchemas.add(rel.schemaId);

    for (const sid of [...usageSchemas].sort((a, b) => a - b)) {
      const s = schemaById.get(sid);
      if (!s) continue;
      lines.push(`GRANT USAGE ON SCHEMA ${pgQuoteIdent(s.name)} TO ${role};`);
    }

    for (const rel of relList) {
      const s = schemaById.get(rel.schemaId);
      if (!s) continue;
      const qs = pgQuoteIdent(s.name);
      const qt = pgQuoteIdent(rel.name);
      lines.push(`GRANT SELECT ON TABLE ${qs}.${qt} TO ${role};`);
    }
  }

  lines.push('');
  lines.push(`COMMIT;`);
  return lines.join('\n');
}

export function buildMysqlReadOnlyScript(
  roleName: string,
  databaseName: string,
  schemas: SchemaRow[],
  access: EffectiveAccess
): string {
  const user = mysqlQuoteUser(roleName);
  const db = mysqlQuoteIdent(databaseName);
  const lines: string[] = [];

  lines.push(`-- Read-only SQL for MySQL / MariaDB`);
  lines.push(`-- Logical database (registered resource name): ${databaseName}`);
  lines.push(`-- User: ${roleName}`);
  lines.push(
    `-- Revokes privileges on this database, then grants SELECT per access_right. Table qualification uses schema names from the resource catalog (MySQL database/schema).`
  );
  emitPasswordPlaceholderPreamble(lines);
  buildMysqlCreateUserIfMissing(roleName, lines);
  lines.push(`REVOKE ALL PRIVILEGES, GRANT OPTION ON ${db}.* FROM ${user};`);
  lines.push('');

  const schemaById = new Map(schemas.map((s) => [s.schema_id, s]));

  if (access.fullDb) {
    lines.push(`GRANT SELECT ON ${db}.* TO ${user};`);
  } else {
    for (const sid of [...access.fullSchemaIds].sort((a, b) => a - b)) {
      const s = schemaById.get(sid);
      if (!s) continue;
      const sch = mysqlQuoteIdent(s.name);
      lines.push(`GRANT SELECT ON ${sch}.* TO ${user};`);
    }

    const relList = [...access.relations.values()].sort((a, b) => {
      const sa = schemaById.get(a.schemaId)?.name ?? '';
      const sb = schemaById.get(b.schemaId)?.name ?? '';
      const c = sa.localeCompare(sb, undefined, { sensitivity: 'base' });
      if (c !== 0) return c;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    for (const rel of relList) {
      const s = schemaById.get(rel.schemaId);
      if (!s) continue;
      const sch = mysqlQuoteIdent(s.name);
      const tbl = mysqlQuoteIdent(rel.name);
      lines.push(`GRANT SELECT ON ${sch}.${tbl} TO ${user};`);
    }
  }

  if (
    !access.fullDb &&
    access.fullSchemaIds.size === 0 &&
    access.relations.size === 0
  ) {
    lines.push(`-- No access_right rows for this group on this database — only REVOKE was emitted above.`);
  }

  return lines.join('\n');
}

export function buildOracleReadOnlyScript(
  roleName: string,
  databaseName: string,
  schemas: SchemaRow[],
  access: EffectiveAccess
): string {
  const lines: string[] = [];
  lines.push(`-- Read-only SQL for Oracle Database`);
  lines.push(`-- Registered database resource name: ${databaseName}`);
  lines.push(`-- Grantee: ${roleName}`);
  lines.push(
    `-- Oracle has no direct equivalent to PostgreSQL REVOKE on all objects in a schema. Remove broader grants manually, then apply the GRANT SELECT statements below.`
  );
  emitPasswordPlaceholderPreamble(lines);
  buildOracleCreateUserIfMissing(roleName, lines);

  const schemaById = new Map(schemas.map((s) => [s.schema_id, s]));

  if (access.fullDb) {
    for (const s of sortSchemas(schemas)) {
      lines.push(
        `-- Full schema "${s.name}" access: enumerate tables/views in this schema and grant SELECT (not generated here).`
      );
    }
    lines.push(
      `-- Tip: use a script that loops over ALL_TABLES for owner ${roleName} or use a read-only role profile.`
    );
    return lines.join('\n');
  }

  const emitTable = (schemaName: string, objectName: string) => {
    const o = `"${schemaName.replace(/"/g, '""')}"."${objectName.replace(/"/g, '""')}"`;
    lines.push(`GRANT SELECT ON ${o} TO "${roleName.replace(/"/g, '""')}";`);
  };

  for (const sid of [...access.fullSchemaIds].sort((a, b) => a - b)) {
    const s = schemaById.get(sid);
    if (!s) continue;
    lines.push(
      `-- Schema-level access "${s.name}": grant SELECT on each table/view in this schema (see sync inventory), or use a PL/SQL loop over ALL_OBJECTS.`
    );
  }

  const relList = [...access.relations.values()].sort((a, b) => {
    const sa = schemaById.get(a.schemaId)?.name ?? '';
    const sb = schemaById.get(b.schemaId)?.name ?? '';
    const c = sa.localeCompare(sb, undefined, { sensitivity: 'base' });
    if (c !== 0) return c;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  for (const rel of relList) {
    const s = schemaById.get(rel.schemaId);
    if (!s) continue;
    emitTable(s.name, rel.name);
  }

  if (
    !access.fullDb &&
    access.fullSchemaIds.size === 0 &&
    access.relations.size === 0
  ) {
    lines.push(`-- No table/view-level grants to emit for this group on this database.`);
  }

  return lines.join('\n');
}

export function buildSqliteNote(): string {
  return [
    `-- SQLite does not implement GRANT/REVOKE or server-side database users.`,
    `-- Use application-level access control or OS file permissions on the database file.`,
  ].join('\n');
}

export function buildReadOnlyScriptForDbms(
  dbmsCode: string,
  roleName: string,
  databaseName: string,
  schemas: SchemaRow[],
  grantRows: GrantRowForSql[],
  databaseId: number
): { sql: string; partial: boolean; note?: string } {
  const access = computeEffectiveAccess(grantRows, databaseId);

  switch (dbmsCode) {
    case 'PGS':
      return { sql: buildPostgresReadOnlyScript(roleName, databaseName, schemas, access), partial: false };
    case 'MYQ':
      return { sql: buildMysqlReadOnlyScript(roleName, databaseName, schemas, access), partial: false };
    case 'ORA':
      return {
        sql: buildOracleReadOnlyScript(roleName, databaseName, schemas, access),
        partial: true,
        note: 'Oracle script includes table/view GRANTs only; full-database and full-schema access need manual object enumeration.',
      };
    case 'SLT':
      return { sql: buildSqliteNote(), partial: true, note: 'SQLite has no user-level SQL grants.' };
    default:
      return {
        sql: [
          `-- Unsupported DBMS code: ${dbmsCode}`,
          `-- Refer to your vendor documentation to mirror read-only access for role "${roleName}".`,
        ].join('\n'),
        partial: true,
        note: `No generator for DBMS ${dbmsCode}.`,
      };
  }
}

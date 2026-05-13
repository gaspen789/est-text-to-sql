export const databasesList = [
  {
    database_id: 1,
    database_name: 'TestDB',
    description_for_llm: 'Test database',
    comment_for_user: null,
    is_active_database: true,
    host_name: 'localhost',
    port: 5432,
    username: 'admin',
    dbms_version_id: 1,
    dbms_code: 'POSTGRESQL',
    dbms_name: 'PostgreSQL',
    dbms_version: '15',
    dbms_version_description: null,
    is_active_credential: true,
    is_admin_credential: true,
  },
];

export const dbmsVersionsActive = [
  { dbms_version_id: 1, dbms_code: 'POSTGRESQL', dbms_name: 'PostgreSQL', version: '15' },
];

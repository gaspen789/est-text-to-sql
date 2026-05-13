import { fulfillJson, type ApiMock } from './api';
import { buildRolesMock, adminRole } from './adminApiMocks';
import { databasesList, dbmsVersionsActive } from '../fixtures/databases';

export function buildDatabasesPageMocks(): ApiMock[] {
  return [
    buildRolesMock(adminRole),
    { method: 'GET', pathname: '/api/admin/databases', handler: ({ route }) => fulfillJson(route, databasesList) },
    { method: 'GET', pathname: '/api/admin/classifiers/dbms-versions/active', handler: ({ route }) => fulfillJson(route, dbmsVersionsActive) },
  ];
}

import { fulfillJson, type ApiMock } from './api';
import { adminUsersList } from '../fixtures/users';

export type RoleRow = { user_role_code: string; user_role_name: string };

export const adminRole: RoleRow[] = [{ user_role_code: 'ADM', user_role_name: 'Administrator' }];
export const regularRole: RoleRow[] = [{ user_role_code: 'CHA', user_role_name: 'Chat User' }];

export function buildRolesMock(roles: RoleRow[]): ApiMock {
  return {
    method: 'GET',
    pathname: '/api/user/roles',
    handler: ({ route }) => fulfillJson(route, roles),
  };
}

/** All API mocks needed by the /users admin page. Includes the ADM roles mock. */
export function buildAdminUsersPageMocks(): ApiMock[] {
  return [
    buildRolesMock(adminRole),
    {
      method: 'GET',
      pathname: '/api/admin/users',
      handler: ({ route }) => fulfillJson(route, adminUsersList),
    },
    {
      method: 'GET',
      pathname: '/api/admin/roles',
      handler: ({ route }) => fulfillJson(route, adminRole),
    },
    {
      method: 'GET',
      pathname: '/api/admin/groups',
      handler: ({ route }) => fulfillJson(route, []),
    },
    {
      method: 'GET',
      pathname: '/api/keeled',
      handler: ({ route }) =>
        fulfillJson(route, [{ language_code: 'en', language_name: 'English' }]),
    },
  ];
}

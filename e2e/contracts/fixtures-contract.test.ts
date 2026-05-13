import { describe, it, expect } from 'vitest';
import { chatsList, chat10Messages, llmNamesActive } from '../fixtures/chat';
import { llmsAll, llmApiForModel1 } from '../fixtures/manager';
import { adminUsersList } from '../fixtures/users';
import { adminChatsList, adminChatsOverviewEmpty } from '../fixtures/admin-chats';
import { databasesList, dbmsVersionsActive } from '../fixtures/databases';

/**
 * This test is intentionally boring: the real safety comes from TypeScript's
 * `satisfies` checks in the fixture modules. Keeping at least one runtime test
 * ensures Vitest is wired and the fixtures are importable in CI.
 */
describe('E2E fixtures contract', () => {
  it('fixtures are present', () => {
    expect(Array.isArray(llmNamesActive)).toBe(true);
    expect(Array.isArray(chatsList)).toBe(true);
    expect(Array.isArray(chat10Messages)).toBe(true);
    expect(Array.isArray(llmsAll)).toBe(true);
    expect(Array.isArray(llmApiForModel1)).toBe(true);
  });

  // 14.1 adminUsersList fixture shape
  it('14.1 adminUsersList has required shape', () => {
    expect(Array.isArray(adminUsersList)).toBe(true);
    expect(adminUsersList.length).toBeGreaterThan(0);
    const first = adminUsersList[0];
    expect(typeof first.app_user_id).toBe('number');
    expect(typeof first.email).toBe('string');
    expect(typeof first.is_active).toBe('boolean');
  });

  // 14.2 adminChatsList fixture shape
  it('14.2 adminChatsList has required shape', () => {
    expect(typeof adminChatsList).toBe('object');
    expect(typeof adminChatsList.total).toBe('number');
    expect(Array.isArray(adminChatsList.rows)).toBe(true);
    expect(adminChatsList.rows.length).toBeGreaterThan(0);
    const first = adminChatsList.rows[0];
    expect(typeof first.chat_id).toBe('number');
    expect(typeof first.title).toBe('string');
  });

  // 14.3 adminChatsOverviewEmpty fixture shape
  it('14.3 adminChatsOverviewEmpty has required shape', () => {
    expect(typeof adminChatsOverviewEmpty).toBe('object');
    expect(typeof adminChatsOverviewEmpty.messages).toBe('object');
    expect(typeof adminChatsOverviewEmpty.messages.today).toBe('number');
  });

  // 14.4 databasesList fixture shape
  it('14.4 databasesList has required shape', () => {
    expect(Array.isArray(databasesList)).toBe(true);
    expect(databasesList.length).toBeGreaterThan(0);
    const first = databasesList[0];
    expect(typeof first.database_id).toBe('number');
    expect(typeof first.database_name).toBe('string');
    expect(typeof first.is_active_database).toBe('boolean');
    expect(Array.isArray(dbmsVersionsActive)).toBe(true);
    expect(dbmsVersionsActive.length).toBeGreaterThan(0);
    expect(typeof dbmsVersionsActive[0].dbms_version_id).toBe('number');
  });
});

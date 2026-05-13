export type AdminUserRow = {
  app_user_id: number;
  email: string;
  preferred_llm_language: string;
  llm_custom_global_instruction: string | null;
  is_active: boolean;
  created_at_time: string;
  modified_at_time: string;
  user_role_codes: string;
  user_role_names: string;
  user_group_codes: string;
  user_group_names: string;
};

export const adminUsersList: AdminUserRow[] = [
  {
    app_user_id: 1,
    email: 'admin@example.com',
    preferred_llm_language: 'en',
    llm_custom_global_instruction: null,
    is_active: true,
    created_at_time: new Date('2026-01-01T00:00:00Z').toISOString(),
    modified_at_time: new Date('2026-01-01T00:00:00Z').toISOString(),
    user_role_codes: 'ADM',
    user_role_names: 'Administrator',
    user_group_codes: '',
    user_group_names: '',
  },
  {
    app_user_id: 2,
    email: 'user@example.com',
    preferred_llm_language: 'en',
    llm_custom_global_instruction: null,
    is_active: true,
    created_at_time: new Date('2026-01-02T00:00:00Z').toISOString(),
    modified_at_time: new Date('2026-01-02T00:00:00Z').toISOString(),
    user_role_codes: 'CHA',
    user_role_names: 'Chat User',
    user_group_codes: '',
    user_group_names: '',
  },
];

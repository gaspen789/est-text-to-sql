export const adminChatsOverviewEmpty = {
  range: { from: null, to: null },
  messages: { today: 5, week: 32, month: 120, year: 450, flagged_total: 3, in_range: 32 },
  messages_over_time: null,
  llm_usage: [{ used_llm_id: 1, used_llm_name: 'Test LLM', message_count: 32 }],
};

export const adminChatsList = {
  limit: 10,
  offset: 0,
  total: 2,
  rows: [
    {
      chat_id: 10,
      title: 'Admin chat 1',
      start_time: new Date('2026-04-01T10:00:00Z').toISOString(),
      app_user_id: 2,
      user_email: 'user@example.com',
      last_message_time: new Date('2026-04-01T10:05:00Z').toISOString(),
      message_count: 4,
      flagged_count: 1,
      llms_used: [{ used_llm_id: 1, used_llm_name: 'Test LLM' }],
    },
    {
      chat_id: 11,
      title: 'Admin chat 2',
      start_time: new Date('2026-04-02T09:00:00Z').toISOString(),
      app_user_id: 2,
      user_email: 'user@example.com',
      last_message_time: new Date('2026-04-02T09:10:00Z').toISOString(),
      message_count: 2,
      flagged_count: 0,
      llms_used: [{ used_llm_id: 1, used_llm_name: 'Test LLM' }],
    },
  ],
};

export const adminChat10MessagesResp = {
  chat: {
    chat_id: 10,
    title: 'Admin chat 1',
    start_time: new Date('2026-04-01T10:00:00Z').toISOString(),
    app_user_id: 2,
    user_email: 'user@example.com',
  },
  range: { from: null, to: null },
  rows: [
    {
      message_id: 201,
      encrypted_content: 'Hello from the admin user',
      sent_time: new Date('2026-04-01T10:01:00Z').toISOString(),
      is_sent_by_user: true,
      is_flagged_by_user: false,
      used_llm_id: 1,
      used_llm_name: 'Test LLM',
    },
    {
      message_id: 202,
      encrypted_content: 'Hello from the admin assistant',
      sent_time: new Date('2026-04-01T10:02:00Z').toISOString(),
      is_sent_by_user: false,
      is_flagged_by_user: true,
      used_llm_id: 1,
      used_llm_name: 'Test LLM',
    },
  ],
};

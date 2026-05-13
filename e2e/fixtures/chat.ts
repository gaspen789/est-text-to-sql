import type { ChatMessageRow, LlmNameRow } from '../../frontend/src/types/api/chat';
import type { ChatRow } from '../../frontend/src/contexts/chat-session-context';

export const llmNamesActive = [
  { llm_id: 1, llm_name: 'Test LLM' },
] satisfies LlmNameRow[];

export const chatsList = [
  { chat_id: 10, title: 'Welcome chat', start_time: new Date('2026-01-01T12:00:00.000Z').toISOString() },
] satisfies ChatRow[];

export const chat10Messages = [
  {
    message_id: 100,
    encrypted_content: 'Hello from assistant',
    sent_time: new Date('2026-01-01T12:00:01.000Z').toISOString(),
    is_sent_by_user: false,
    is_flagged_by_user: false,
    used_llm_id: 1,
    used_llm_name: 'Test LLM',
  },
  {
    message_id: 101,
    encrypted_content: 'Hello from user',
    sent_time: new Date('2026-01-01T12:00:02.000Z').toISOString(),
    is_sent_by_user: true,
    is_flagged_by_user: false,
    used_llm_id: 1,
  },
] satisfies ChatMessageRow[];


export type LlmNameRow = {
  llm_id: number;
  llm_name: string;
};

export type ChatMessageRow = {
  message_id: number;
  encrypted_content: string;
  sent_time: string;
  is_sent_by_user: boolean;
  is_flagged_by_user: boolean;
  used_llm_id: number;
  used_llm_name?: string;
  /** Time from user request received to assistant finished, in milliseconds (assistant messages only). */
  answering_time_ms?: number | null;
};

import { ErrorCodes } from './errors/codes.js';

export type MappedError = { code: string; params?: Record<string, string | number> };

/** Map PostgreSQL / driver errors to stable codes for the client. Never expose raw DB text. */
export function mapPgErrorToCode(err: unknown): MappedError {
  if (err && typeof err === 'object') {
    const e = err as { message?: string; detail?: string };
    const errorString = `${e.message ?? ''} ${e.detail ?? ''}`.toLowerCase();

    if (errorString.includes('uq_llm_model_name')) {
      return { code: ErrorCodes.LLM_NAME_NOT_UNIQUE };
    }
    if (errorString.includes('chk_llm_model_name')) {
      return { code: ErrorCodes.LLM_NAME_FORMAT_INVALID };
    }
    if (errorString.includes('chk_llm_version')) {
      return { code: ErrorCodes.LLM_VERSION_FORMAT_INVALID };
    }
    if (errorString.includes('chk_llm_contect_length')) {
      return { code: ErrorCodes.LLM_CONTEXT_LENGTH_INVALID };
    }
    if (errorString.includes('chk_llm_release_date_allowed_range')) {
      return { code: ErrorCodes.LLM_RELEASE_DATE_RANGE_INVALID };
    }
    if (errorString.includes('chk_llm_created_at_time_allowed_range')) {
      return { code: ErrorCodes.LLM_CREATED_AT_RANGE_INVALID };
    }
    if (errorString.includes('chk_llm_modified_at_time_allowed_range')) {
      return { code: ErrorCodes.LLM_MODIFIED_AT_RANGE_INVALID };
    }
    if (errorString.includes('chk_llm_created_at_time_before_modified')) {
      return { code: ErrorCodes.LLM_CREATED_BEFORE_MODIFIED_INVALID };
    }
    if (errorString.includes('chk_llm_max_output_tokens')) {
      return { code: ErrorCodes.LLM_MAX_OUTPUT_TOKENS_INVALID };
    }
    if (errorString.includes('fk_llm_llm_group')) {
      return { code: ErrorCodes.LLM_GROUP_INVALID_OR_FORBIDDEN };
    }
    if (errorString.includes('fk_llm_creator') || errorString.includes('fk_llm_modifier')) {
      return { code: ErrorCodes.LLM_USER_REFERENCE_INVALID };
    }
    if (errorString.includes('uq_chat_app_user_id_title')) {
      return { code: ErrorCodes.CHAT_TITLE_ALREADY_EXISTS };
    }
  }
  return { code: ErrorCodes.INTERNAL_ERROR };
}

/**
 * Maps PostgreSQL FK violations raised while removing an LLM row.
 * Uses `constraint` when present; falls back to matching known names in the driver message.
 */
export function mapLlmDeleteForeignKeyError(err: unknown): MappedError | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { code?: string; constraint?: string; message?: string; detail?: string };
  if (e.code !== '23503') return null;
  const c = typeof e.constraint === 'string' ? e.constraint : '';
  const blob = `${c} ${e.message ?? ''} ${e.detail ?? ''}`;
  if (blob.includes('fk_llm_api_llm')) {
    return { code: ErrorCodes.LLM_DELETE_HAS_API };
  }
  if (blob.includes('fk_llm_price_llm')) {
    return { code: ErrorCodes.LLM_DELETE_HAS_PRICING };
  }
  if (blob.includes('fk_message_used_llm')) {
    return { code: ErrorCodes.LLM_DELETE_REFERENCED_BY_MESSAGES };
  }
  return null;
}

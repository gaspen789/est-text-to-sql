import type { Request } from 'express';
import en from '../../frontend/src/translations/en.json';
import et from '../../frontend/src/translations/et.json';

export type ChatUiLocale = 'et' | 'en';

/** Matches frontend `getClientAcceptLanguage()` (`Accept-Language`: `et` | `en`). Defaults to `et`. */
export function resolveChatUiLocale(req: Request): ChatUiLocale {
  const raw = req.headers['accept-language'] as string | string[] | undefined;
  let head = '';
  if (typeof raw === 'string') head = raw;
  else if (Array.isArray(raw) && raw[0] != null) head = String(raw[0]);
  const tag = head.split(',')[0]?.trim().split('-')[0]?.toLowerCase() ?? '';
  if (tag.startsWith('en')) return 'en';
  if (tag.startsWith('et')) return 'et';
  return 'et';
}

export type ChatUserFacingErrors = {
  unableToGenerate: string;
  llmStreamFailed: string;
};

function pickChatErrors(root: unknown): ChatUserFacingErrors {
  const chat = root && typeof root === 'object' ? (root as Record<string, unknown>).chat : null;
  const c = chat && typeof chat === 'object' ? (chat as Record<string, unknown>) : null;
  const unableToGenerate = c?.assistantUnableToGenerate;
  const llmStreamFailed = c?.assistantLlmStreamFailed;
  if (typeof unableToGenerate !== 'string' || typeof llmStreamFailed !== 'string') {
    throw new Error(
      'Missing chat.assistantUnableToGenerate or chat.assistantLlmStreamFailed in translations'
    );
  }
  return { unableToGenerate, llmStreamFailed };
}

const byLocale: Record<ChatUiLocale, ChatUserFacingErrors> = {
  en: pickChatErrors(en),
  et: pickChatErrors(et),
};

export function getChatUserFacingErrors(locale: ChatUiLocale): ChatUserFacingErrors {
  return byLocale[locale];
}

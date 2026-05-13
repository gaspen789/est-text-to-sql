import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

/**
 * Maps llm_group_company (case-insensitive) to a Vercel AI SDK model factory.
 * Returns a function that accepts a model ID string and returns a LanguageModelV1.
 */
export function createLLMProvider(
  companyName: string,
  apiKey: string
): (modelId: string) => LanguageModel {
  const normalized = companyName.trim().toLowerCase();

  if (normalized === 'anthropic') {
    const provider = createAnthropic({ apiKey });
    return (modelId) => provider(modelId);
  }

  if (normalized === 'openai') {
    const provider = createOpenAI({ apiKey });
    return (modelId) => provider(modelId);
  }

  if (normalized === 'google' || normalized === 'google deepmind') {
    const provider = createGoogleGenerativeAI({ apiKey });
    return (modelId) => provider(modelId);
  }

  throw new Error(`Unrecognized LLM provider company: "${companyName}"`);
}

import type { LanguageModel } from '../../frontend/src/types';
import type { LlmApiCredentialRow } from '../../frontend/src/lib/llmApiCredentials';

export const llmsAll = [
  {
    llm_id: 1,
    llm_name: 'Model A',
    llm_group_id: 10,
    llm_group_name: 'Group X',
    llm_group_is_active: true,
    model_company_name: 'Company Y',
    model_company_is_active: true,
    model_company_country: 'EE',
    model_company_country_is_active: true,
    llm_version: '1.0',
    llm_context_length: 8192,
    llm_max_output_tokens: 2048,
    llm_other_parameters: [],
    llm_release_date: new Date('2025-01-01T00:00:00.000Z').toISOString(),
    is_local_llm: false,
    is_active_llm: true,
    llm_created_at: new Date('2025-01-02T00:00:00.000Z').toISOString(),
    llm_creator_email: 'creator@example.com',
    llm_last_modified_at: new Date('2025-01-03T00:00:00.000Z').toISOString(),
    llm_last_modifier_email: 'modifier@example.com',
  },
  {
    llm_id: 2,
    llm_name: 'Model B',
    llm_group_id: 10,
    llm_group_name: 'Group X',
    llm_group_is_active: true,
    model_company_name: 'Company Y',
    model_company_is_active: true,
    model_company_country: 'EE',
    model_company_country_is_active: true,
    llm_version: '2.0',
    llm_context_length: 4096,
    llm_max_output_tokens: 1024,
    llm_other_parameters: [],
    llm_release_date: new Date('2024-01-01T00:00:00.000Z').toISOString(),
    is_local_llm: true,
    is_active_llm: false,
    llm_created_at: new Date('2024-01-02T00:00:00.000Z').toISOString(),
    llm_creator_email: 'creator@example.com',
    llm_last_modified_at: new Date('2024-01-03T00:00:00.000Z').toISOString(),
    llm_last_modifier_email: 'modifier@example.com',
  },
] satisfies LanguageModel[];

export const llmApiForModel1 = [{ llm_api_id: 1, api_key: 'non-empty' }] satisfies LlmApiCredentialRow[];


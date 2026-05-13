export type ParameterEntry = {
  key: string;
  value: any;
};

export type ModelGroup = {
  llm_group_id: number;
  llm_group_name: string;
  llm_group_company?: string;
};

export type LanguageModel = {
  llm_id?: number;
  llm_name: string;
  llm_group_id?: number;
  llm_group_name: string;
  llm_group_is_active?: boolean;
  model_company_name: string;
  model_company_is_active?: boolean;
  model_company_country: string;
  model_company_country_is_active?: boolean;
  llm_version: string;
  llm_context_length?: number;
  llm_max_output_tokens?: number;
  llm_other_parameters: ParameterEntry[];
  llm_release_date: string;
  is_local_llm: boolean;
  is_active_llm: boolean;
  llm_created_at: string;
  llm_creator_email: string;
  llm_last_modified_at: string;
  llm_last_modifier_email: string;
};

export type LLMCreate = {
  model_name: string;
  llm_group_id: number;
  version: string;
  context_length?: number;
  max_output_tokens?: number;
  other_parameters: ParameterEntry[];
  release_date?: string;
  is_local: boolean;
  is_active: boolean;
};

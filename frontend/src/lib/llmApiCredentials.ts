/** Row from GET /api/llm-api/:llmId (api_key decrypted on the server). */
export type LlmApiCredentialRow = {
  llm_api_id?: number | null;
  api_key?: string | null;
};

/** True when the model has at least one stored API row with a non-empty API key. */
export function llmHasApiCredentials(rows: LlmApiCredentialRow[]): boolean {
  return rows.some(
    (r) => r.llm_api_id != null && typeof r.api_key === 'string' && r.api_key.trim() !== ''
  );
}

import type { Response } from 'express';

/** Values JSON-serialized in error responses (arrays used e.g. for invalid code lists). */
export type ApiErrorParamValue = string | number | string[] | number[];

export type ApiErrorBody = {
  code: string;
  params?: Record<string, ApiErrorParamValue>;
};

export function sendApiError(
  res: Response,
  status: number,
  code: string,
  params?: Record<string, ApiErrorParamValue>
): Response {
  const body: ApiErrorBody = params && Object.keys(params).length > 0 ? { code, params } : { code };
  return res.status(status).json(body);
}

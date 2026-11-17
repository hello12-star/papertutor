export type ProviderErrorCode =
  | "LLM_NOT_CONFIGURED"
  | "LLM_UPSTREAM_ERROR"
  | "LLM_EMPTY_RESPONSE"
  | "DOCMIND_NOT_CONFIGURED"
  | "PARSER_NOT_IMPLEMENTED"
  | "INVALID_HELP_JSON"
  | "MOCK_PROVIDER_FORBIDDEN";

export class ProviderError extends Error {
  code: ProviderErrorCode;
  status: number;
  detail?: string;

  constructor(code: ProviderErrorCode, message: string, status = 503, detail?: string) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}
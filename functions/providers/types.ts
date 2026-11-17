export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmRequest = {
  messages: LlmMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
};

export type LlmResult = {
  text: string;
  model: string;
  usage?: Record<string, number>;
};

export interface LlmProvider {
  id: string;
  complete(request: LlmRequest): Promise<LlmResult>;
}

export type ParseInput = {
  file: ArrayBuffer;
  fileName: string;
  mimeType?: string;
};

export type ParseResult = {
  markdown: string;
  pages?: number;
  meta?: Record<string, string>;
};

export interface ParserProvider {
  id: string;
  parse(input: ParseInput): Promise<ParseResult>;
}
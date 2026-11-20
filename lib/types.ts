export type Citation = {
  section?: string;
  quote: string;
  verified?: boolean;
};

export type Prerequisite = {
  term: string;
  english?: string;
  why: string;
  suggest?: string;
};

export type QuickView = {
  meta: {
    title: string;
    authors: string;
    venue: string;
    year: string;
  };
  coreQuestion: string;
  coreContribution: string;
  methodSummary: string;
  prerequisites: Prerequisite[];
  readingPath: {
    first: string[];
    keyFigure: string;
    skip: string[];
  };
};

export type MethodModule = {
  name: string;
  role?: string;
  input: string;
  output: string;
  goal: string;
  next?: string;
  citations: Citation[];
};

export type Experiment = {
  name: string;
  claim: string;
  finding: string;
  verdict: "supports" | "partial" | "missing";
  citations: Citation[];
};

export type Skeleton = {
  problem: {
    summary: string;
    limitations: string[];
    importance?: string;
    citations: Citation[];
  };
  insight: {
    summary: string;
    citations: Citation[];
  };
  modules: MethodModule[];
  experiments: Experiment[];
  limitations: {
    stated: string[];
    inferred: string[];
    citations: Citation[];
  };
};

export type FormulaCard = {
  name: string;
  formula: string;
  latex?: string;
  meaning: string;
  where?: string;
};

export type Analysis = {
  quickview: QuickView;
  skeleton: Skeleton;
  formulas?: FormulaCard[];
};

export type ParsedDoc = {
  hash: string;
  fileName: string;
  fileSize: number;
  pages: number | null;
  mode: "flash" | "token" | "demo" | "docmind";
  markdown: string;
  parsedAt: number;
  sourceUrl?: string;
  sourceLabel?: string;
};

export type AnalysisRecord = {
  analysis: Analysis;
  model: string;
  createdAt: number;
};

export type CitationStats = {
  total: number;
  verified: number;
  units: number;
  unitsWithCitation: number;
  unitsWithVerified: number;
};

export type PhaseKey = "read" | "parse" | "quickview" | "skeleton";

export type Phase = {
  key: PhaseKey;
  label: string;
  detail: string;
  status: "pending" | "active" | "done" | "error";
};

export type AppError = {
  title: string;
  message: string;
  hint?: string;
  kind?: "need_key" | "limit" | "network" | "parse" | "llm" | "generic";
  raw?: string;
};
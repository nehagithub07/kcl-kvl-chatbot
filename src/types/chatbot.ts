export interface QAItem {
  id: number;
  category: string;
  question: string;
  variations: string[];
  keywords: string[];
  answer: string;
  procedureOverview?: boolean;
  quiz?: {
    stage: string;
    number: number;
    requiresDiagram: boolean;
  };
  guideStep?: {
    order: number;
    instruction: string;
  };
}

export type Experiment = "KCL" | "KVL";

export interface ChatContext {
  experiment?: Experiment;
  lastMatchedId?: number;
  walkthroughStep?: number;
}

export interface ChatResponse {
  answer: string;
  matched: boolean;
  matchedQuestion?: string;
  context: ChatContext;
}

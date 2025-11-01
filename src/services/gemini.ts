import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";

export { interpolateTemplate } from "../util/templates";

export type GeminiGenerateTextParams = {
  apiKey: string;
  model: string;
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  responseMimeType?: "text/plain" | "application/json";
};

export type GeminiUsageSummary = {
  promptTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
};

export type GeminiGenerateTextResult = {
  text: string;
  usage: GeminiUsageSummary;
  response: GenerateContentResponse;
};

let cachedClient: {
  apiKey: string;
  client: GoogleGenAI;
} | null = null;

const getClient = (apiKey: string) => {
  if (cachedClient?.apiKey === apiKey) {
    return cachedClient.client;
  }

  const client = new GoogleGenAI({ apiKey });
  cachedClient = { apiKey, client };
  return client;
};

export const generateText = async (
  params: GeminiGenerateTextParams,
): Promise<GeminiGenerateTextResult> => {
  const client = getClient(params.apiKey);

  const response = await client.models.generateContent({
    model: params.model,
    contents: params.prompt,
    config: {
      systemInstruction: params.systemInstruction || undefined,
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      maxOutputTokens: params.maxOutputTokens,
      responseMimeType: params.responseMimeType,
    },
  });

  const usageMetadata = response.usageMetadata;
  const promptTokens = usageMetadata?.promptTokenCount;
  const responseTokens = usageMetadata?.candidatesTokenCount;
  const totalTokens =
    typeof promptTokens === "number" && typeof responseTokens === "number"
      ? promptTokens + responseTokens
      : undefined;

  return {
    text: response.text ?? "",
    usage: { promptTokens, responseTokens, totalTokens },
    response,
  };
};

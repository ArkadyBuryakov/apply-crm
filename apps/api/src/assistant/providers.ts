// Model providers for the in-app assistant (ADR 0031): model lists fetched live with the user's key, language models,
// provider-specific web search tools and reasoning options.
import { type AnthropicLanguageModelOptions, createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { createOpenAI, type OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import { AI_PROVIDERS, type AiProvider } from "@crm/shared";
import type { LanguageModel, streamText, ToolSet } from "ai";

type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>;

export const PROVIDER_NAMES: Record<AiProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
};

export type ModelRef = { provider: AiProvider; modelId: string };

/** Chats store their model as `provider:modelId`. */
export function parseModelRef(value: string): ModelRef | null {
  const i = value.indexOf(":");
  const provider = value.slice(0, i) as AiProvider;
  const modelId = value.slice(i + 1);
  return i > 0 && modelId && AI_PROVIDERS.includes(provider) ? { provider, modelId } : null;
}

export type ModelInfo = { id: string; provider: AiProvider; modelId: string; name: string };

/** The provider rejected the key (401/403). */
export class ProviderKeyError extends Error {}

async function getJson(url: string, headers: Record<string, string>, fetchImpl: typeof fetch) {
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 || res.status === 403) throw new ProviderKeyError("The provider rejected this API key");
  if (!res.ok) throw new Error(`The provider answered ${res.status} when listing models`);
  return (await res.json()) as Record<string, unknown>;
}

// OpenAI lists every model the key can reach, including embeddings, audio and image models.
const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/;
const OPENAI_EXCLUDE = /(audio|realtime|transcribe|tts|image|embedding|moderation|instruct|search|dall-e|whisper)/;

/** Chat-capable models the key can use, newest first where the provider says so. */
export async function listModels(
  provider: AiProvider,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelInfo[]> {
  const info = (modelId: string, name: string): ModelInfo => ({
    id: `${provider}:${modelId}`,
    provider,
    modelId,
    name,
  });
  switch (provider) {
    case "anthropic": {
      const body = await getJson(
        "https://api.anthropic.com/v1/models?limit=1000",
        { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        fetchImpl,
      );
      const data = (body.data ?? []) as { id: string; display_name?: string }[];
      return data.map((m) => info(m.id, m.display_name ?? m.id));
    }
    case "openai": {
      const body = await getJson("https://api.openai.com/v1/models", { authorization: `Bearer ${apiKey}` }, fetchImpl);
      const data = (body.data ?? []) as { id: string; created?: number }[];
      return data
        .filter((m) => OPENAI_CHAT.test(m.id) && !OPENAI_EXCLUDE.test(m.id))
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
        .map((m) => info(m.id, m.id));
    }
    case "google": {
      const body = await getJson(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
        { "x-goog-api-key": apiKey },
        fetchImpl,
      );
      const data = (body.models ?? []) as {
        name: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }[];
      return data
        .filter((m) => m.name.startsWith("models/gemini") && m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => info(m.name.replace(/^models\//, ""), m.displayName ?? m.name));
    }
  }
}

export function languageModel(ref: ModelRef, apiKey: string): LanguageModel {
  switch (ref.provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(ref.modelId);
    case "openai":
      return createOpenAI({ apiKey })(ref.modelId);
    case "google":
      return createGoogle({ apiKey })(ref.modelId);
  }
}

// Claude 4.6+ (except Haiku 4.x) supports adaptive thinking and the dynamic-filtering web tools.
function isModernClaude(modelId: string) {
  const m = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d+))?/.exec(modelId);
  if (!m) return false;
  const major = Number(m[2]);
  const minor = Number(m[3] ?? 0);
  return major >= 5 || (major === 4 && minor >= 6 && m[1] !== "haiku");
}

const isOpenAIReasoning = (modelId: string) => /^(o\d|gpt-([5-9]|\d{2}))/.test(modelId);
const isGeminiThinking = (modelId: string) => /gemini-(2\.5|[3-9])/.test(modelId);

/** The provider's built-in web tools. Results are billed to the user's key. */
export function webSearchTools(ref: ModelRef, apiKey: string): ToolSet {
  switch (ref.provider) {
    case "anthropic": {
      const { tools } = createAnthropic({ apiKey });
      return isModernClaude(ref.modelId)
        ? {
            web_search: tools.webSearch_20260318({ maxUses: 5, responseInclusion: "excluded" }),
            web_fetch: tools.webFetch_20260318({ maxUses: 5, responseInclusion: "excluded" }),
          }
        : { web_search: tools.webSearch_20250305({ maxUses: 5 }) };
    }
    case "openai":
      return { web_search: createOpenAI({ apiKey }).tools.webSearch() };
    case "google":
      return { google_search: createGoogle({ apiKey }).tools.googleSearch({}) };
  }
}

/** Shows reasoning where the model offers it, and keeps OpenAI from storing conversations server-side. */
export function providerOptions(ref: ModelRef): ProviderOptions {
  switch (ref.provider) {
    case "anthropic":
      return isModernClaude(ref.modelId)
        ? {
            anthropic: {
              thinking: { type: "adaptive", display: "summarized" },
            } satisfies AnthropicLanguageModelOptions,
          }
        : {};
    case "openai":
      return {
        openai: {
          store: false,
          ...(isOpenAIReasoning(ref.modelId)
            ? { include: ["reasoning.encrypted_content"], reasoningSummary: "auto" }
            : {}),
        } satisfies OpenAILanguageModelResponsesOptions,
      };
    case "google":
      return isGeminiThinking(ref.modelId)
        ? { google: { thinkingConfig: { includeThoughts: true } } satisfies GoogleLanguageModelOptions }
        : {};
  }
}

/** Model access as a service, so tests can swap in mock models (see Services). */
export type AiProviders = {
  languageModel(ref: ModelRef, apiKey: string): LanguageModel;
  listModels(provider: AiProvider, apiKey: string): Promise<ModelInfo[]>;
};

export const liveAiProviders: AiProviders = {
  languageModel,
  listModels: (provider, apiKey) => listModels(provider, apiKey),
};

/** Anthropic needs explicit cache breakpoints; the other providers cache automatically. */
export function cacheBreakpoint(ref: ModelRef) {
  return ref.provider === "anthropic" ? { anthropic: { cacheControl: { type: "ephemeral" as const } } } : undefined;
}

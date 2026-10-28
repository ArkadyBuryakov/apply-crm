// A scripted stand-in for the model providers (ADR 0031): each model call plays the next scripted step and records
// the prompt it received, so tests can drive the assistant's tool loop without network access.

import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import type { AiProvider } from "@crm/shared";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { type AiProviders, type ModelInfo, ProviderKeyError } from "../src/assistant/providers.js";

export type Step = { text: string } | { toolCalls: { name: string; input: Record<string, unknown> }[] };

export const VALID_KEY = "fake-provider-key-ok";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

export class FakeAi implements AiProviders {
  readonly prompts: LanguageModelV4CallOptions["prompt"][] = [];
  private steps: Step[] = [];
  private callIds = 0;

  /** Queues the model's next responses, one per model call. */
  script(...steps: Step[]) {
    this.steps.push(...steps);
  }

  /** Drops unplayed steps; returns how many there were. */
  reset() {
    const left = this.steps.length;
    this.steps = [];
    return left;
  }

  async listModels(provider: AiProvider, apiKey: string): Promise<ModelInfo[]> {
    if (apiKey !== VALID_KEY) throw new ProviderKeyError("The provider rejected this API key");
    return [{ id: `${provider}:test-model`, provider, modelId: "test-model", name: "Test model" }];
  }

  languageModel() {
    return new MockLanguageModelV4({
      doStream: async (options) => {
        this.prompts.push(options.prompt);
        const step = this.steps.shift() ?? { text: "(no scripted step)" };
        return { stream: simulateReadableStream({ chunks: this.chunks(step) }) };
      },
    });
  }

  private chunks(step: Step): LanguageModelV4StreamPart[] {
    if ("text" in step) {
      return [
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: step.text },
        { type: "text-end", id: "t" },
        { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
      ];
    }
    return [
      ...step.toolCalls.map(
        (call): LanguageModelV4StreamPart => ({
          type: "tool-call",
          toolCallId: `call_${++this.callIds}`,
          toolName: call.name,
          input: JSON.stringify(call.input),
        }),
      ),
      { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage },
    ];
  }
}

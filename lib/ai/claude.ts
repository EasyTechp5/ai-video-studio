import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env, requireEnv } from "@/lib/env";

let client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY", "Claude API") });
  return client;
}

export class AiOutputError extends Error {
  constructor(message: string, public readonly raw?: unknown) {
    super(message);
    this.name = "AiOutputError";
  }
}

function toInputSchema(schema: z.ZodType): Anthropic.Tool["input_schema"] {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete json.$schema;
  return json as Anthropic.Tool["input_schema"];
}

/**
 * Ask Claude for output that MUST match a zod schema. Uses a forced tool call so the
 * response is structured JSON, validates it, and gives Claude one repair attempt with the
 * validation errors before failing honestly.
 */
export async function generateStructured<T extends z.ZodType>(opts: {
  schema: T;
  toolName: string;
  toolDescription: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const tool: Anthropic.Tool = {
    name: opts.toolName,
    description: opts.toolDescription,
    input_schema: toInputSchema(opts.schema),
  };
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.user }];

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await anthropic().messages.create({
      model: env.claudeModel,
      max_tokens: opts.maxTokens ?? 8000,
      system: opts.system,
      messages,
      tools: [tool],
      tool_choice: { type: "tool", name: opts.toolName },
    });
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!block) throw new AiOutputError("Claude returned no structured output", res.content);

    const parsed = opts.schema.safeParse(block.input);
    if (parsed.success) return parsed.data;

    if (attempt === 1) {
      throw new AiOutputError(`Claude output failed validation: ${parsed.error.message}`, block.input);
    }
    messages.push({ role: "assistant", content: res.content });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: block.id,
          is_error: true,
          content: `Your output did not match the schema. Fix these problems and call the tool again:\n${parsed.error.message}`,
        },
      ],
    });
  }
  throw new AiOutputError("unreachable");
}

export interface PlainOptions {
  system: string;
  user: string;
  maxTokens?: number;
}
export async function generateText(opts: PlainOptions): Promise<string> {
  const res = await anthropic().messages.create({
    model: env.claudeModel,
    max_tokens: opts.maxTokens ?? 2000,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

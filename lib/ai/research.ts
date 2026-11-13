import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, generateStructured } from "@/lib/ai/claude";
import { RESEARCH_STRUCTURE_SYSTEM, RESEARCH_SYSTEM, briefToText, type ProjectBrief } from "@/lib/ai/prompts";
import { env } from "@/lib/env";
import { researchOutputSchema } from "@/types/schemas";

export interface ResearchSource {
  title: string;
  url: string;
  domain: string;
  retrieved_at: string;
  excerpt?: string;
}

export interface ResearchResult {
  performed: boolean;
  summary: string;
  key_facts: { fact: string; source_urls: string[] }[];
  creative_notes: string;
  sources: ResearchSource[];
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Real research: Claude drives Anthropic's server-side web search tool. Sources are collected
 * from the search *results and citations in the API response*, never from model-written text,
 * so a citation can only exist if a search actually returned it.
 */
export async function researchTopic(brief: ProjectBrief, mode: "quick" | "detailed"): Promise<ResearchResult> {
  const res = await anthropic().messages.create({
    model: env.claudeModel,
    max_tokens: 6000,
    system: RESEARCH_SYSTEM,
    messages: [
      {
        role: "user",
        content: `${briefToText(brief)}\n\nResearch depth: ${mode}. Search for what this video needs to be accurate and engaging.`,
      },
    ],
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: mode === "detailed" ? 8 : 3 },
    ],
  });

  const retrievedAt = new Date().toISOString();
  const byUrl = new Map<string, ResearchSource>();
  let notes = "";

  for (const block of res.content) {
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const r of block.content) {
        if (r.type === "web_search_result" && !byUrl.has(r.url)) {
          byUrl.set(r.url, { title: r.title, url: r.url, domain: domainOf(r.url), retrieved_at: retrievedAt });
        }
      }
    }
    if (block.type === "text") {
      notes += block.text;
      for (const c of block.citations ?? []) {
        if (c.type === "web_search_result_location") {
          const src = byUrl.get(c.url);
          if (src && c.cited_text && !src.excerpt) src.excerpt = c.cited_text.slice(0, 400);
        }
      }
    }
  }

  const sources = [...byUrl.values()];
  if (sources.length === 0) {
    // Be honest: nothing was retrieved, so we did not research.
    return {
      performed: false,
      summary: notes.trim() || "No web sources could be retrieved for this topic.",
      key_facts: [],
      creative_notes: "",
      sources: [],
    };
  }

  const structured = await generateStructured({
    schema: researchOutputSchema,
    toolName: "record_research",
    toolDescription: "Record the structured research package.",
    system: RESEARCH_STRUCTURE_SYSTEM,
    user: `<sources>\n${sources.map((s) => `- ${s.title} (${s.url})`).join("\n")}\n</sources>\n\n<notes>\n${notes}\n</notes>`,
    maxTokens: 4000,
  });

  const allowed = new Set(sources.map((s) => s.url));
  return {
    performed: true,
    summary: structured.summary,
    key_facts: structured.key_facts.map((f) => ({
      fact: f.fact,
      source_urls: f.source_urls.filter((u) => allowed.has(u)), // drop any URL we didn't retrieve
    })),
    creative_notes: structured.creative_notes,
    sources,
  };
}

export function researchToPromptText(r: { summary: string | null; key_facts: unknown; creative_notes?: string }): string {
  const facts = (r.key_facts as { fact: string }[] | null) ?? [];
  return [r.summary ?? "", ...facts.map((f) => `- ${f.fact}`)].join("\n");
}

export type { Anthropic };

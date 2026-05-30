#!/usr/bin/env node
import Anthropic from "@anthropic-ai/sdk";
import * as https from "https";
import * as http from "http";

const SYSTEM = `You are a consumer rights expert and plain-language specialist.
Analyze Terms of Service / Privacy Policy documents and return ONLY valid JSON.

Response format:
{
  "grade": "A|B|C|D|F",
  "grade_reason": "one sentence",
  "summary": "2-3 sentence plain English summary of what you agree to",
  "red_flags": [
    { "clause": "exact quote under 20 words", "plain_english": "what this means for you", "severity": "critical|high|medium" }
  ],
  "data_collected": ["list of data types collected"],
  "data_shared_with": ["list of third parties"],
  "user_rights": ["list of rights users have"],
  "cancellation": "how to cancel / delete your account",
  "arbitration": true,
  "class_action_waiver": true,
  "sells_data": true,
  "law_enforcement_disclosure": "description or null",
  "last_updated": "date or null"
}`;

export interface TOSAnalysis {
  grade: string; grade_reason: string; summary: string;
  red_flags: Array<{ clause: string; plain_english: string; severity: string }>;
  data_collected: string[]; data_shared_with: string[]; user_rights: string[];
  cancellation: string; arbitration: boolean; class_action_waiver: boolean;
  sells_data: boolean; law_enforcement_disclosure: string | null; last_updated: string | null;
}

async function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "Mozilla/5.0 TOS-Analyzer/1.0" } }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function stripHtml(html: string): string {
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    .slice(0, 30000);
}

export async function analyzeTOS(input: string): Promise<TOSAnalysis> {
  const client = new Anthropic();
  let text = input;
  if (input.startsWith("http")) { const html = await fetchUrl(input); text = stripHtml(html); }

  const resp = await client.messages.create({
    model: "claude-sonnet-4-20250514", max_tokens: 3000, system: SYSTEM,
    messages: [{ role: "user", content: `Analyze this Terms of Service:\n\n${text}` }],
  });

  const raw = (resp.content[0] as any).text.trim()
    .replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "");
  return JSON.parse(raw);
}

async function cli() {
  const url = process.argv[2];
  if (!url) { console.log("Usage: tos-analyze <url-or-text>"); process.exit(0); }
  const result = await analyzeTOS(url);
  if (process.argv.includes("--json")) { console.log(JSON.stringify(result, null, 2)); return; }

  const gradeColor: Record<string,string> = { A:"\x1b[32m", B:"\x1b[32m", C:"\x1b[33m", D:"\x1b[31m", F:"\x1b[31m" };
  const reset = "\x1b[0m";
  console.log(`\nGrade: ${gradeColor[result.grade] ?? ""}${result.grade}${reset} — ${result.grade_reason}`);
  console.log(`\nSummary: ${result.summary}`);
  if (result.red_flags.length) {
    console.log("\n🚩 Red flags:");
    result.red_flags.forEach(f => console.log(`  [${f.severity.toUpperCase()}] "${f.clause}"\n    → ${f.plain_english}`));
  }
  console.log(`\nData collected: ${result.data_collected.join(", ")}`);
  console.log(`Sells data: ${result.sells_data ? "YES ⚠️" : "No"}`);
  console.log(`Arbitration clause: ${result.arbitration ? "Yes" : "No"}`);
  console.log(`Class action waiver: ${result.class_action_waiver ? "Yes" : "No"}`);
}

cli().catch(console.error);

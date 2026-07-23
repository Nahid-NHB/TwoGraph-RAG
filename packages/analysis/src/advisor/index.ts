import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmProvider } from '@twograph/llm';
import { z } from 'zod';
import { runRulePack, type RuleFinding } from './rules.js';

export { runRulePack, RULE_PACK } from './rules.js';
export type { Rule, RuleFinding } from './rules.js';

export const patchSuggestionSchema = z.object({
  operation: z.literal('apply_patch'),
  params: z.object({
    file: z.string(),
    startLine: z.number(),
    endLine: z.number(),
    newText: z.string(),
  }),
});
export type PatchSuggestion = z.infer<typeof patchSuggestionSchema>;

export const advisorFindingSchema = z.object({
  ruleId: z.string(),
  message: z.string(),
  line: z.number(),
  severity: z.enum(['info', 'warning']),
});

export const advisorReportSchema = z.object({
  symbolId: z.string(),
  findings: z.array(advisorFindingSchema),
  advice: z.string(),
  suggestedPatch: patchSuggestionSchema.nullable(),
});
export type AdvisorReport = z.infer<typeof advisorReportSchema>;

function readGuidelines(rootPath: string, guidelinesFile: string): string | undefined {
  const path = join(rootPath, guidelinesFile);
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

const SYSTEM_PROMPT =
  "You are a senior code reviewer. Given a symbol's source, a list of " +
  "static-analysis findings, and the project's own guidelines (if any), " +
  'compose a short, prioritized set of suggestions. Defer to the project ' +
  'guidelines over generic best practice when they conflict — if a ' +
  'guideline explicitly permits something a finding flags, say so and drop ' +
  'or downgrade it rather than repeating the generic advice.';

function buildFindingsText(findings: RuleFinding[]): string {
  if (findings.length === 0) return '(no rule-pack findings)';
  return findings
    .map((f) => `- [${f.severity}] ${f.ruleId} (line ${String(f.line)}): ${f.message}`)
    .join('\n');
}

/** The only rule with a safe, mechanical, always-valid auto-fix. */
function suggestPatch(
  findings: RuleFinding[],
  file: string,
  sourceText: string,
  startLine: number,
): PatchSuggestion | null {
  const finding = findings.find((f) => f.ruleId === 'a11y-img-alt');
  if (!finding) return null;

  const lines = sourceText.split('\n');
  const lineText = lines[finding.line - 1];
  if (!lineText) return null;
  const patched = lineText.replace(/<img\b/i, '<img alt=""');
  if (patched === lineText) return null;

  const fileLine = startLine + finding.line - 1;
  return {
    operation: 'apply_patch',
    params: { file, startLine: fileLine, endLine: fileLine, newText: patched },
  };
}

/**
 * Deterministic rule-pack findings (issue #69) plus an LLM-composed,
 * guidelines-aware narrative. `.twograph/guidelines.md` (path given by
 * `guidelinesFile`, from `config.guidelinesFile`) is read fresh each call so
 * contrasting guidelines change the prompt — and therefore the advice — for
 * the same findings.
 *
 * Only `a11y-img-alt` gets an auto-generated patch suggestion: a safe,
 * always-valid mechanical fix. Every other rule needs human judgment, so it
 * gets a finding but no suggested patch. Either way, this module only ever
 * *returns* a suggestion — the caller decides whether to actually call
 * `proposeEdit` and materialize it as a pending edit; nothing here writes.
 */
export async function runAdvisor(
  llm: LlmProvider,
  symbolId: string,
  filePath: string,
  sourceText: string,
  startLine: number,
  rootPath: string,
  guidelinesFile: string,
): Promise<AdvisorReport> {
  const findings = runRulePack(sourceText);
  const guidelines = readGuidelines(rootPath, guidelinesFile);

  const result = await llm.complete({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `File: ${filePath}\n\n\`\`\`\n${sourceText}\n\`\`\`\n\nStatic findings:\n${buildFindingsText(findings)}` +
          (guidelines ? `\n\nProject guidelines (.twograph/guidelines.md):\n${guidelines}` : ''),
      },
    ],
  });

  return {
    symbolId,
    findings,
    advice: result.content,
    suggestedPatch: suggestPatch(findings, filePath, sourceText, startLine),
  };
}

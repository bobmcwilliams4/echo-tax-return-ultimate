// ═══════════════════════════════════════════════════════════════════════════
// ECHO TAX RETURN ULTIMATE — Claude Opus Subprocess Service
// Calls Claude CLI as subprocess for deep tax analysis (Layer 3)
// ═══════════════════════════════════════════════════════════════════════════

import { spawn } from 'child_process';
import { createLogger } from '../utils/logger';

const log = createLogger('claude-subprocess');

const CLAUDE_TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS || '60000', 10);
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-7';

interface ClaudeResponse {
  result: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  cost_usd: number;
}

interface ClaudeJsonOutput {
  result?: string;
  response?: string;
  content?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  model?: string;
}

function buildSystemPrompt(engineId: string, context: Record<string, unknown>): string {
  const filingStatus = context.filing_status || 'single';
  const taxYear = context.tax_year || 2025;

  return `You are a senior CPA and tax attorney with 30+ years of experience. You are part of the Echo Tax Return Ultimate platform's ${engineId} engine. Your responses must be:

1. DEFENSIBLE — Every conclusion must cite IRC sections, Treasury Regulations, Revenue Rulings, or case law
2. PRECISE — Dollar amounts to the penny, percentages to 2 decimal places
3. CURRENT — Tax year ${taxYear} rates, limits, and phase-outs
4. CONSERVATIVE — Default to the position that survives audit unless client explicitly accepts risk
5. COMPLETE — Address all applicable forms, schedules, and elections

Filing status: ${filingStatus}
Tax year: ${taxYear}

When analyzing tax situations:
- Start with the IRC section that governs the issue
- Apply relevant Treasury Regulations and case law
- Consider applicable safe harbors and elections
- Identify all reporting requirements (forms, schedules, disclosures)
- Flag any audit risk factors (DIF score triggers, statistical anomalies)
- Provide specific dollar impact calculations
- Note any state tax implications

Format your response as structured analysis with:
- CONCLUSION: Clear answer with dollar amounts
- AUTHORITY: IRC sections, Treas. Reg., Rev. Rul., case citations
- CALCULATION: Step-by-step math
- RISK_LEVEL: DEFENSIBLE | AGGRESSIVE | DISCLOSURE | HIGH_RISK
- FORMS_REQUIRED: List of IRS forms/schedules affected
- OPTIMIZATION: Any available elections or strategies to improve the position`;
}

export async function queryClaudeSubprocess(
  engineId: string,
  query: string,
  context: Record<string, unknown> = {},
): Promise<ClaudeResponse> {
  const start = Date.now();
  const systemPrompt = buildSystemPrompt(engineId, context);
  const fullPrompt = `${systemPrompt}\n\n--- CONTEXT ---\n${JSON.stringify(context, null, 2)}\n\n--- QUERY ---\n${query}`;

  return new Promise((resolve, reject) => {
    const args = [
      '--model', CLAUDE_MODEL,
      '--print',
      '--output-format', 'json',
      '--max-turns', '1',
      '-p', fullPrompt,
    ];

    log.info({ engineId, queryLength: query.length }, 'Spawning Claude subprocess');

    const proc = spawn('claude', args, {
      timeout: CLAUDE_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      const latency = Date.now() - start;

      if (code !== 0) {
        log.error({ code, stderr, latency }, 'Claude subprocess failed');
        resolve({
          result: `Claude analysis unavailable. Error: ${stderr || 'Process exited with code ' + code}. Please consult a qualified tax professional for this question.`,
          model: CLAUDE_MODEL, tokens_in: 0, tokens_out: 0, latency_ms: latency, cost_usd: 0,
        });
        return;
      }

      try {
        const parsed: ClaudeJsonOutput = JSON.parse(stdout);
        const result = parsed.result || parsed.response || parsed.content || stdout;
        const tokensIn = parsed.usage?.input_tokens || Math.ceil(fullPrompt.length / 4);
        const tokensOut = parsed.usage?.output_tokens || Math.ceil(String(result).length / 4);
        const costUsd = (tokensIn * 15 + tokensOut * 75) / 1_000_000;

        log.info({ engineId, latency, tokensIn, tokensOut, costUsd: costUsd.toFixed(4) }, 'Claude subprocess completed');

        resolve({
          result: String(result), model: parsed.model || CLAUDE_MODEL,
          tokens_in: tokensIn, tokens_out: tokensOut, latency_ms: latency, cost_usd: costUsd,
        });
      } catch {
        log.warn({ engineId, latency }, 'Claude output not JSON, returning raw');
        resolve({
          result: stdout.trim(), model: CLAUDE_MODEL,
          tokens_in: Math.ceil(fullPrompt.length / 4), tokens_out: Math.ceil(stdout.length / 4),
          latency_ms: latency, cost_usd: 0,
        });
      }
    });

    proc.on('error', (err) => {
      const latency = Date.now() - start;
      log.error({ err, engineId, latency }, 'Failed to spawn Claude subprocess');
      reject(new Error(`Claude subprocess spawn error: ${err.message}`));
    });
  });
}

export async function checkClaudeAvailability(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('claude', ['--version'], { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'], shell: true });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

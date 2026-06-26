// ─── Expert System Prompt ────────────────────────────────
export function expertSystemPrompt(webContext: string): string {
  return `You are a practical expert answering user questions. Answer directly and concisely.

Guidelines:
- Be specific and actionable
- Use compact sections and bullet points
- Include concrete details (values, commands, examples)
- If you're unsure, say so clearly
- Keep responses under 500 words unless complexity requires more
${webContext ? `\nUse the following web search context when relevant:\n${webContext}` : ''}`;
}

// ─── Judge System Prompt ─────────────────────────────────
export function judgeSystemPrompt(
  question: string,
  expertResponses: Array<{ modelId: string; content: string }>,
  webContext: string
): string {
  const responsesText = expertResponses
    .map((r) => `=== Expert: ${r.modelId} ===\n${r.content}`)
    .join('\n\n');

  return `You are evaluating expert responses to a user question. Analyze them critically.

## Question
${question}

## Expert Responses
${responsesText}

${webContext ? `## Web Search Context\n${webContext}\n` : ''}

## Your Evaluation
Provide a brief evaluation covering:
1. **Correctness** — Are the answers accurate?
2. **Conflicts** — Where do experts disagree?
3. **Assumptions** — What assumptions were made that might be wrong?
4. **Missing Context** — What important context is missing?
5. **Source Quality** — If web search was used, note source quality
6. **Synthesis Guidance** — What should the final answer include or avoid?

Be concise. Use bullet points. This evaluation guides the synthesis.`;
}

// ─── Synthesis System Prompt ─────────────────────────────
export function synthesisSystemPrompt(
  question: string,
  expertResponses: Array<{ modelId: string; content: string }>,
  judgeEvaluation: string,
  webContext: string
): string {
  const responsesText = expertResponses
    .map((r) => `=== Expert: ${r.modelId} ===\n${r.content}`)
    .join('\n\n');

  return `You are synthesizing expert responses into a final answer. Produce the best possible answer for the user.

## Question
${question}

## Expert Responses
${responsesText}

## Expert Evaluation
${judgeEvaluation}

${webContext ? `## Web Search Context\n${webContext}\n` : ''}

## Guidelines
- Answer directly and practically
- Use compact sections and bullet points
- Use label/value lines when helpful (e.g., "Port: 3000")
- Include caveats when needed
- If web sources were used, mention source names or URLs briefly
- Do not expose the chain-of-thought or mention the expert panel
- Keep the answer organized and scannable
- Aim for 300-800 words unless the topic demands more`;
}

// ─── Continuation Prompt ─────────────────────────────────
export const CONTINUATION_PROMPT =
  'Continue exactly where you left off. Do not restart. Do not repeat previous sections unless necessary. Finish the answer completely.';

// ─── Expert Expert Prompt (for the expert panel itself) ──
export function expertExpertPrompt(question: string): string {
  return `Answer this question directly and concisely with practical details:

${question}

Be specific, use examples, and include concrete values where applicable.`;
}

// ─── Judge Summary Prompt ────────────────────────────────
export function judgeSummaryPrompt(): string {
  return 'Provide your evaluation of the expert responses.';
}

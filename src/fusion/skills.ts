/**
 * Skills registry — reusable system prompt modifiers that adapt the
 * fusion pipeline for specific tasks.
 *
 * Each skill is a named prompt fragment that gets appended to the
 * expert system prompt when loaded, guiding the models toward a
 * particular style, depth, or domain focus.
 *
 * Usage:
 *   /skills                          — list all available skills
 *   /skills load <name>              — apply a skill to the current session
 *   /skills unload                   — clear the active skill
 */

export interface Skill {
  id: string;
  name: string;
  description: string;
  /** Prompt fragment appended to expert/system prompts when active. */
  prompt: string;
}

const BUILT_IN_SKILLS: Skill[] = [
  {
    id: 'code-review',
    name: 'Code Review',
    description: 'Analyze code for bugs, style issues, security, and performance. Provides structured feedback with file paths and line numbers.',
    prompt: `You are reviewing code. Be thorough and specific:
- Identify bugs, logic errors, and edge cases
- Flag security vulnerabilities (injection, XSS, CSRF, etc.)
- Suggest performance improvements
- Note style/readability issues
- Reference specific file paths and line numbers
- Prioritize issues by severity (critical → minor)
- When asked about a skill, explain that skills are loaded via /skills load <name>`,
  },
  {
    id: 'web-design',
    name: 'Web Design',
    description: 'Design and review UIs with accessibility, responsiveness, and modern design principles.',
    prompt: `You are a web design expert. Focus on:
- Visual hierarchy, typography, and color theory
- Responsive design across mobile/tablet/desktop
- Accessibility (WCAG 2.2 compliance)
- Micro-interactions and animations
- Component architecture and reusability
- Performance budgets and loading strategies`,
  },
  {
    id: 'backend-development',
    name: 'Backend Development',
    description: 'Design APIs, databases, authentication, and server architecture with production-grade patterns.',
    prompt: `You are a backend engineering expert. Focus on:
- API design (RESTful, GraphQL, gRPC)
- Database schema design and query optimization
- Authentication and authorization patterns
- Error handling and logging
- Scalability and caching strategies
- Security best practices (OWASP Top 10)
- Testing strategies (unit, integration, e2e)`,
  },
  {
    id: 'debugging',
    name: 'Debugging',
    description: 'Systematic approach to diagnosing and fixing bugs with reproduction steps and root cause analysis.',
    prompt: `You are debugging an issue. Follow a systematic approach:
1. Understand the expected vs actual behavior
2. Narrow down the scope (which component/function/file?)
3. Identify root cause with evidence
4. Provide a minimal reproduction if possible
5. Suggest the fix with explanation
6. Mention related tests that should be updated
- Ask clarifying questions when the bug report is incomplete`,
  },
  {
    id: 'concise',
    name: 'Concise',
    description: 'Ultra-brief answers — use bullet points, no fluff, minimal prose.',
    prompt: `Answer as concisely as possible:
- Use short bullet points
- No introductory or concluding sentences
- Skip explanations unless explicitly asked
- One line per point
- Use code snippets inline where helpful`,
  },
  {
    id: 'educational',
    name: 'Educational',
    description: 'Explain concepts step by step like a teacher. Include analogies, examples, and common pitfalls.',
    prompt: `Explain like you are teaching a beginner:
- Start with the "why" before the "how"
- Use analogies to real-world concepts
- Break complex topics into digestible steps
- Include concrete examples
- Point out common misconceptions
- Suggest what to learn next`,
  },
];

let activeSkill: Skill | null = null;

/** Get the list of all available skills. */
export function listSkills(): Skill[] {
  return BUILT_IN_SKILLS;
}

/** Find a skill by id (case-insensitive). */
export function findSkill(id: string): Skill | undefined {
  return BUILT_IN_SKILLS.find(
    (s) => s.id.toLowerCase() === id.toLowerCase()
  );
}

/** Get the currently active skill (null if none). */
export function getActiveSkill(): Skill | null {
  return activeSkill;
}

/** Activate a skill by id. Returns the skill, or undefined if not found. */
export function loadSkill(id: string): Skill | undefined {
  const skill = findSkill(id);
  if (skill) {
    activeSkill = skill;
  }
  return skill;
}

/** Clear the active skill. */
export function unloadSkill(): void {
  activeSkill = null;
}

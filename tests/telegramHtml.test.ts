import { describe, it, expect } from 'vitest';
import { convertToTelegramHtml } from '../src/format/telegramHtml.js';

describe('convertToTelegramHtml', () => {
  it('returns empty string for empty input', () => {
    expect(convertToTelegramHtml('')).toBe('');
  });

  it('escapes HTML in regular text', () => {
    const result = convertToTelegramHtml('Use A & B');
    expect(result).toContain('A &amp; B');
  });

  it('escapes < and >', () => {
    const result = convertToTelegramHtml('x < y and y > x');
    expect(result).toContain('x &lt; y');
    expect(result).toContain('y &gt; x');
  });

  it('bolds section headers', () => {
    const result = convertToTelegramHtml('Configuration\n---\nContent');
    expect(result).toContain('<b>Configuration</b>');
    expect(result).toContain('Content');
  });

  it('converts Markdown headings to bold', () => {
    const result = convertToTelegramHtml('## Important Section\nContent');
    expect(result).toContain('<b>Important Section</b>');
  });

  it('bolds labels in Label: value lines', () => {
    const result = convertToTelegramHtml('Name: Fusion');
    expect(result).toContain('<b>Name:</b>');
    expect(result).toContain('Fusion');
  });

  it('uses code for exact values', () => {
    const result = convertToTelegramHtml('Port: 3000');
    expect(result).toContain('<b>Port:</b>');
    expect(result).toContain('<code>3000</code>');
  });

  it('uses code for path values', () => {
    const result = convertToTelegramHtml('Folder: /path/to/project');
    expect(result).toContain('<code>/path/to/project</code>');
  });

  it('uses code for env var values', () => {
    const result = convertToTelegramHtml('Key: FUSION_SECRET_KEY');
    expect(result).toContain('<code>FUSION_SECRET_KEY</code>');
  });

  it('handles code blocks', () => {
    const input = '```\nconst x = 1;\nconsole.log(x);\n```';
    const result = convertToTelegramHtml(input);
    expect(result).toContain('<pre>');
    expect(result).toContain('const x = 1;');
    expect(result).toContain('console.log(x);');
  });

  it('handles bullet points', () => {
    const result = convertToTelegramHtml('- Item one\n- Item two');
    expect(result).toContain('* Item one');
    expect(result).toContain('* Item two');
  });

  it('handles asterisk bullets', () => {
    const result = convertToTelegramHtml('* Item one\n* Item two');
    expect(result).toContain('* Item one');
    expect(result).toContain('* Item two');
  });

  it('converts URLs to links', () => {
    const result = convertToTelegramHtml('Visit https://example.com for more');
    expect(result).toContain('<a href="https://example.com"');
    expect(result).toContain('example.com');
  });

  it('handles Part X/Y prefix', () => {
    const result = convertToTelegramHtml('Part 1/3 - Introduction');
    expect(result).toContain('<b>Part 1/3</b>');
  });

  it('handles the example from the spec', () => {
    const input = `Checked the setup.

Verified OK

- Project folder: C:\\Path\\To\\Project
- Main script: run.py
- Status: completed successfully

Scheduler

- Task: Free AI API Finder
- Last result: 0

Caveat

- The PC must be awake and logged in.`;

    const result = convertToTelegramHtml(input);

    expect(result).toContain('Checked the setup');
    expect(result).toContain('<b>Verified OK</b>');
    expect(result).toContain('<b>Project folder:</b>');
    expect(result).toContain('<b>Main script:</b>');
    expect(result).toContain('<b>Status:</b>');
    expect(result).toContain('<b>Scheduler</b>');
    expect(result).toContain('<b>Task:</b>');
    expect(result).toContain('<b>Last result:</b>');
    expect(result).toContain('<b>Caveat</b>');
    expect(result).toContain('<code>C:\\Path\\To\\Project</code>');
    expect(result).toContain('<code>run.py</code>');
    expect(result).toContain('<code>0</code>');
  });

  it('formats Sources section with blockquote label', () => {
    const input = 'The capital of France is Paris.\n\nSources\n- https://example.com/france\n- Travel Guide — https://lonelyplanet.com/france';
    const result = convertToTelegramHtml(input);
    expect(result).toContain('<i>Sourced from:</i>');
    expect(result).toContain('example.com/france');
    expect(result).toContain('Travel Guide');
    expect(result).toContain('<b>Travel Guide</b>');
  });

  it('formats References section', () => {
    const input = 'Key findings.\n\nReferences\n[1] Article Title — https://arxiv.org/abs/1234';
    const result = convertToTelegramHtml(input);
    expect(result).toContain('<i>Sourced from:</i>');
    expect(result).toContain('<code>[1]</code>');
  });

  it('formats numbered steps with bold numbers', () => {
    const result = convertToTelegramHtml('1. First step\n2. Second step');
    expect(result).toContain('<b>1.</b>');
    expect(result).toContain('<b>2.</b>');
  });

  it('formats inline source citations [N]', () => {
    const result = convertToTelegramHtml('[1] Reference title here');
    expect(result).toContain('<code>[1]</code>');
  });

  it('keeps bullet items as bullets', () => {
    const result = convertToTelegramHtml('* 1. This is not a numbered step');
    expect(result).toContain('*');
  });

  it('handles Markdown bold', () => {
    const result = convertToTelegramHtml('This is **bold** text');
    expect(result).toContain('<b>bold</b>');
  });

  it('handles inline code', () => {
    const result = convertToTelegramHtml('Use the `config` variable');
    expect(result).toContain('<code>config</code>');
  });

  it('does not produce empty bold tags', () => {
    const result = convertToTelegramHtml('');
    expect(result).not.toContain('<b></b>');
  });
});

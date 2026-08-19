/**
 * Render Template Handler
 *
 * Renders HTML templates with data using Mustache syntax.
 * Templates are stored per-source in the workspace.
 */

import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { successResponse, errorResponse } from '../response.ts';
import { loadTemplate, validateTemplateData } from '../templates/loader.ts';
import { renderMustache } from '../templates/mustache.ts';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isPathWithinDirectory, isPathWithinDirectoryForCreation } from '../runtime/path-security.ts';

export interface RenderTemplateArgs {
  source: string;
  template: string;
  data: Record<string, unknown>;
}

/**
 * Handle the render_template tool call.
 *
 * 1. Validates source and template exist
 * 2. Soft-validates data against template @required fields
 * 3. Renders template with Mustache
 * 4. Writes output HTML to session data folder
 * 5. Returns absolute path for use in html-preview blocks
 */
const SAFE_SOURCE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export async function handleRenderTemplate(
  ctx: SessionToolContext,
  args: RenderTemplateArgs
): Promise<ToolResult> {
  if (!ctx.dataPath) {
    return errorResponse('render_template requires dataPath in context.');
  }

  if (!SAFE_SOURCE_SEGMENT.test(args.source) || args.source.includes('..')) {
    return errorResponse(`Invalid source identifier: ${args.source}`);
  }

  const sourcesRoot = resolve(ctx.workspacePath, 'sources');
  const sourcePath = resolve(sourcesRoot, args.source);

  if (!isPathWithinDirectory(sourcePath, sourcesRoot)) {
    return errorResponse(`Source "${args.source}" is outside the workspace sources directory`);
  }

  // Validate source exists
  if (!existsSync(sourcePath)) {
    return errorResponse(
      `Source "${args.source}" not found at ${sourcePath}`
    );
  }

  // Load template
  const template = loadTemplate(sourcePath, args.template);
  if (!template) {
    return errorResponse(
      `Template "${args.template}" not found for source "${args.source}".\n\nExpected file: ${join(sourcePath, 'templates', `${args.template}.html`)}`
    );
  }

  // Soft validation
  const warnings = validateTemplateData(template.meta, args.data);

  // Render template
  let rendered: string;
  try {
    rendered = renderMustache(template.content, args.data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return errorResponse(`Error rendering template "${args.template}": ${msg}`);
  }

  // Write output to session data folder
  const dataDir = ctx.dataPath;
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const outputFileName = `${args.source}-${args.template}-${Date.now()}.html`.replace(/[^a-zA-Z0-9._-]/g, '_');
  const outputPath = join(dataDir, outputFileName);
  if (!isPathWithinDirectoryForCreation(outputPath, dataDir)) {
    return errorResponse('Refusing to write template output outside the session data directory.');
  }
  writeFileSync(outputPath, rendered, 'utf-8');

  // Build response
  const lines: string[] = [];
  lines.push(`Rendered template: ${template.meta.name || args.template}`);
  lines.push(`Output: ${outputPath}`);
  lines.push('');
  lines.push(`Use this absolute path as the "src" value in your html-preview block.`);

  if (warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of warnings) {
      lines.push(`  - ${w.message}`);
    }
    lines.push('The template was rendered but may have blank sections. Consider re-rendering with the missing fields.');
  }

  return successResponse(lines.join('\n'));
}

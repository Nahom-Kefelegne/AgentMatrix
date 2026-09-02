export const MAX_MERMAID_SOURCE_CHARACTERS = 12_000;
export const MAX_MERMAID_SOURCE_LINES = 300;
export const MAX_MERMAID_EDGE_TOKENS = 240;
export const MAX_MERMAID_SVG_CHARACTERS = 512 * 1024;

const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'image',
  'feimage',
  'animate',
  'animatemotion',
  'animatetransform',
  'mpath',
  'set',
]);
const UNSAFE_PROTOCOL = /(?:javascript|data|https?|file):|(?:^|[\s"'(])\/\//i;
const URL_REFERENCE = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const NETWORK_IMAGE_FUNCTION =
  /\b(?:-webkit-)?image-set\s*\(|\b(?:cross-fade|element|paint)\s*\(/i;

export interface PreparedMermaidSource {
  source: string;
  error: string | null;
}

function splitMermaidStatements(line: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && quote) {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === ';') {
      statements.push(line.slice(start, index));
      start = index + 1;
    }
  }
  statements.push(line.slice(start));
  return statements;
}

function stripClickDirectives(source: string): string {
  const diagramHeader = source
    .split(/\r\n|\r|\n/)
    .map(line => line.trim())
    .find(line => line && !line.startsWith('%%')) ?? '';
  if (!/^(?:flowchart|graph|classDiagram)\b/i.test(diagramHeader)) {
    return source;
  }
  return source
    .split(/\r\n|\r|\n/)
    .map(line => splitMermaidStatements(line)
      .filter(statement => !/^\s*click\s+/i.test(statement))
      .join(';'))
    .filter(line => line.trim())
    .join('\n');
}

export function prepareMermaidSource(source: string): PreparedMermaidSource {
  if (!source.trim()) {
    return { source: '', error: 'The Mermaid block is empty.' };
  }
  if (
    /%%\s*\{/i.test(source)
    || /^\s*---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/.test(source)
  ) {
    return {
      source: '',
      error: 'Document-provided Mermaid configuration is not supported.',
    };
  }
  if (/@\{/.test(source)) {
    return {
      source: '',
      error: 'Advanced Mermaid node metadata is not supported.',
    };
  }
  const sourceWithoutClicks = stripClickDirectives(source);
  if (!sourceWithoutClicks.trim()) {
    return {
      source: '',
      error: 'The Mermaid block contains no renderable diagram content.',
    };
  }
  if (
    /@\{\s*[^}]*\bimg\s*:/i.test(sourceWithoutClicks)
    || /<\s*(?:img|image)\b/i.test(sourceWithoutClicks)
    || /\b(?:url|(?:-webkit-)?image-set|cross-fade|element|paint)\s*\(/i.test(sourceWithoutClicks)
    || /(?:javascript|data|https?|file):|(?:^|[\s"'(])\/\//i.test(sourceWithoutClicks)
  ) {
    return {
      source: '',
      error: 'External resources are not supported in Mermaid diagrams.',
    };
  }
  if (source.length > MAX_MERMAID_SOURCE_CHARACTERS) {
    return {
      source: '',
      error: `Diagram source exceeds ${MAX_MERMAID_SOURCE_CHARACTERS.toLocaleString()} characters.`,
    };
  }
  const lines = source.split(/\r\n|\r|\n/);
  if (lines.length > MAX_MERMAID_SOURCE_LINES) {
    return {
      source: '',
      error: `Diagram source exceeds ${MAX_MERMAID_SOURCE_LINES.toLocaleString()} lines.`,
    };
  }
  const edgeTokens =
    sourceWithoutClicks.match(/-->|---|==>|-.->|~~~|--x|--o/g)?.length ?? 0;
  if (edgeTokens > MAX_MERMAID_EDGE_TOKENS) {
    return {
      source: '',
      error: `Diagram exceeds ${MAX_MERMAID_EDGE_TOKENS.toLocaleString()} relationship edges.`,
    };
  }
  return { source: sourceWithoutClicks, error: null };
}

export function validateMermaidSource(source: string): string | null {
  return prepareMermaidSource(source).error;
}

function hasUnsafeValue(value: string): boolean {
  if (UNSAFE_PROTOCOL.test(value) || NETWORK_IMAGE_FUNCTION.test(value)) return true;
  let match: RegExpExecArray | null;
  URL_REFERENCE.lastIndex = 0;
  while ((match = URL_REFERENCE.exec(value))) {
    if (!match[2].trim().startsWith('#')) return true;
  }
  return false;
}

function hasMotionStyle(value: string): boolean {
  return /(?:^|[;{\s])(?:animation|transition)(?:-[\w-]+)?\s*:|@keyframes/i.test(value);
}

function stripMotionCss(value: string): string {
  return value
    .replace(
      /@(?:-webkit-)?keyframes[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/gi,
      '',
    )
    .replace(
      /(?:^|[;{\s])(?:animation|transition)(?:-[\w-]+)?\s*:[^;}]+;?/gi,
      match => match.startsWith('{') ? '{' : match.match(/^[;\s]+/)?.[0] ?? '',
    );
}

export function sanitizeMermaidSvg(svgMarkup: string): SVGSVGElement {
  if (svgMarkup.length > MAX_MERMAID_SVG_CHARACTERS) {
    throw new Error('Generated diagram exceeds the SVG size limit.');
  }
  const parsed = new DOMParser().parseFromString(svgMarkup, 'text/html');
  const root = parsed.querySelector('svg');
  if (!root) {
    throw new Error('Mermaid did not return an SVG diagram.');
  }

  for (const element of Array.from(root.querySelectorAll('*'))) {
    const name = element.localName.toLocaleLowerCase();
    if (FORBIDDEN_ELEMENTS.has(name)) {
      element.remove();
      continue;
    }
    if (name === 'a') {
      element.removeAttribute('href');
      element.removeAttribute('xlink:href');
      element.removeAttribute('target');
      element.setAttribute('pointer-events', 'none');
    }
    if (name === 'style') {
      const css = element.textContent ?? '';
      if (
        /@import|@font-face|expression\s*\(|javascript:|data:|https?:|file:/i.test(css)
        || hasUnsafeValue(css)
      ) {
        element.remove();
      } else {
        element.textContent = stripMotionCss(css);
      }
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLocaleLowerCase();
      if (
        attributeName.startsWith('on')
        || attributeName === 'href'
        || attributeName === 'xlink:href'
        || hasUnsafeValue(attribute.value)
        || (attributeName === 'style' && hasMotionStyle(attribute.value))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  for (const attribute of Array.from(root.attributes)) {
    const attributeName = attribute.name.toLocaleLowerCase();
    if (
      attributeName.startsWith('on')
      || attributeName === 'href'
      || attributeName === 'xlink:href'
      || hasUnsafeValue(attribute.value)
      || (attributeName === 'style' && hasMotionStyle(attribute.value))
    ) {
      root.removeAttribute(attribute.name);
    }
  }
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', 'Mermaid diagram');
  root.setAttribute('focusable', 'false');
  root.removeAttribute('style');
  root.removeAttribute('height');
  root.removeAttribute('width');
  return root;
}

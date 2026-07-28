const MARKDOWN_EXTENSIONS = /\.(?:md|markdown)$/i;

export function isMarkdownPath(path: string | undefined): boolean {
  return Boolean(path && MARKDOWN_EXTENSIONS.test(path));
}

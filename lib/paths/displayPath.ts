export function toPosixPath(value: string): string {
  return value.replaceAll('\\', '/');
}

export function baseName(value: string): string {
  const normalized = toPosixPath(value).replace(/\/+$/, '');
  return normalized.split('/').pop() || value;
}

export function parentPath(value: string): string {
  const normalized = toPosixPath(value).replace(/\/+$/, '');
  const separator = normalized.lastIndexOf('/');
  return separator > 0
    ? normalized.slice(0, separator)
    : separator === 0
      ? '/'
      : '';
}

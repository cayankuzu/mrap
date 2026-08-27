export function formatMessage(template: string, values: Readonly<Record<string, string | number>>) {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (placeholder, key: string) => (
    Object.hasOwn(values, key) ? String(values[key]) : placeholder
  ));
}

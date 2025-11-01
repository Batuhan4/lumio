export const interpolateTemplate = (
  template: string,
  variables: Record<string, string>,
) =>
  template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key)
      ? (variables[key] ?? "")
      : "",
  );

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

export type ToolHandler = (args: Record<string, any>) => Promise<string>;

export const TOOL_DEFINITIONS: ToolDefinition[] = [];
export const TOOL_HANDLERS: Record<string, ToolHandler> = {};

export function registerTool(
  name: string,
  description: string,
  schema: Record<string, any>,
  handler: ToolHandler,
): void {
  TOOL_DEFINITIONS.push({ name, description, input_schema: schema });
  TOOL_HANDLERS[name] = handler;
}

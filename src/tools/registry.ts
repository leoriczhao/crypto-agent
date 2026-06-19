export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

export type ToolDep =
  | "exchange"
  | "config"
  | "memory"
  | "sessionId"
  | "soul"
  | "exchange_manager"
  | "broker"
  | "agent"
  | "skill_loader"
  | "strategy_store";

export type ToolHandler = (args: Record<string, any>) => Promise<string>;

export const TOOL_DEFINITIONS: ToolDefinition[] = [];
export const TOOL_HANDLERS: Record<string, ToolHandler> = {};
export const TOOL_DEPS: Record<string, ToolDep[]> = {};

export function registerTool(
  name: string,
  description: string,
  schema: Record<string, any>,
  deps: ToolDep[],
  handler: ToolHandler,
): void {
  TOOL_DEFINITIONS.push({ name, description, input_schema: schema });
  TOOL_HANDLERS[name] = handler;
  TOOL_DEPS[name] = deps;
}

TOOL_DEFINITIONS = []
TOOL_HANDLERS = {}


def register_tool(name: str, description: str, schema: dict):
    def decorator(func):
        TOOL_DEFINITIONS.append({
            "name": name,
            "description": description,
            "input_schema": schema,
        })
        TOOL_HANDLERS[name] = func
        return func
    return decorator

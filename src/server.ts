import { McpServer } from "@modelcontextprotocol/server";
import { version } from "../package.json";
import { GarminApiClient } from "./api-client";
import type { Config } from "./config";
import { GarminDashboard, registerDashboard } from "./dashboard";
import { registerPrompts } from "./prompts";
import { GarminTools, registerTools } from "./tools";

/** The garmin-personal MCP server with its 13 tools and 3 prompts. */
export function createServer(config: Config): McpServer {
  const server = new McpServer({ name: "garmin-personal", version });
  const api = new GarminApiClient(config);
  const tools = new GarminTools(api, config.dataDir);
  registerTools(server, tools);
  registerDashboard(server, new GarminDashboard(tools, api, config.dataDir));
  registerPrompts(server);
  return server;
}

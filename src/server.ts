import { McpServer } from "@modelcontextprotocol/server";
import { version } from "../package.json";
import { GarminApiClient } from "./api-client";
import type { Config } from "./config";
import { GarminTools, registerTools } from "./tools";

/** The garmin-personal MCP server with its tools. */
export function createServer(config: Config): McpServer {
  const server = new McpServer({ name: "garmin-personal", version });
  registerTools(server, new GarminTools(new GarminApiClient(config), config.dataDir));
  return server;
}

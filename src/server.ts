import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/server";
import { version } from "../package.json";
import { GarminApiClient } from "./api-client";
import type { Config } from "./config";
import { GarminDashboard, registerDashboard } from "./dashboard";
import { DashboardWriter, registerDashboardWriter } from "./dashboard-page";
import { registerPrompts } from "./prompts";
import { AutoRefresh, registerSchedule } from "./schedule";
import { GarminTools, registerTools } from "./tools";

/** The page template; the build writes it next to dist/index.js. */
const template = () => readFile(new URL("./dashboard.html", import.meta.url), "utf8");

/** The tools, the dashboard data and the page writer, wired to one API client. */
export function createParts(config: Config) {
  const api = new GarminApiClient(config);
  const tools = new GarminTools(api, config.dataDir);
  const dashboard = new GarminDashboard(tools, api, config.dataDir);
  const writer = new DashboardWriter(
    (weeks, workouts) => dashboard.getDashboardData(weeks, workouts),
    config.dataDir,
    template,
  );
  return { tools, dashboard, writer };
}

/** The garmin-personal MCP server with its tools and prompts. */
export function createServer(config: Config): McpServer {
  const server = new McpServer({ name: "garmin-personal", version });
  const { tools, dashboard, writer } = createParts(config);
  registerTools(server, tools);
  registerDashboard(server, dashboard);
  registerDashboardWriter(server, writer);
  registerSchedule(server, new AutoRefresh(config));
  registerPrompts(server);
  return server;
}

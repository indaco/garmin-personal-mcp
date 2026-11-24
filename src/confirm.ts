import {
  acceptedContent,
  CLIENT_CAPABILITIES_META_KEY,
  type InputRequiredResult,
  inputRequired,
  inputResponse,
  type McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { isObject } from "./tools";

/** `ask`: return it from the handler. `unasked`: the client cannot ask, and the caller decides what to do. */
export type Confirm = { ask: InputRequiredResult } | { answer: "yes" | "no" | "unasked" };

const ANSWER = z.object({ confirm: z.boolean().describe("Yes, do it") });

/**
 * Asks the user, not the model, before a write that has no undo. The SDK calls the handler again
 * with the answer, so the handler must write nothing before it asks.
 */
export function confirm(
  server: McpServer,
  ctx: ServerContext,
  key: string,
  message: string,
): Confirm {
  const responses = ctx.mcpReq.inputResponses;
  if (inputResponse(responses, key).kind !== "missing") {
    // the answer comes from the client: only a checked true is a yes
    return { answer: acceptedContent(responses, key, ANSWER)?.confirm === true ? "yes" : "no" };
  }
  // the 2026-07-28 era has the capabilities only in the request; a 2025 connection only on the server
  const envelope: Record<string, unknown> = ctx.mcpReq.envelope ?? {};
  const inRequest = envelope[CLIENT_CAPABILITIES_META_KEY];
  const capabilities = isObject(inRequest) ? inRequest : server.server.getClientCapabilities();
  if (!capabilities?.elicitation) return { answer: "unasked" };
  return {
    ask: inputRequired({
      inputRequests: { [key]: inputRequired.elicit({ message, requestedSchema: ANSWER }) },
    }),
  };
}

import type { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import * as z from "zod/v4";
import { confirm } from "../src/confirm";
import { type Answer, closeAll, connect, type Era } from "./elicitation-client";

afterEach(closeAll);

/** A tool that asks and gives the answer as its text. */
function asking(server: McpServer): void {
  server.registerTool("ask", { inputSchema: z.object({}) }, async (_args, ctx) => {
    const c = confirm(server, ctx, "confirm", "Delete it? Confirm?");
    return "ask" in c ? c.ask : { content: [{ type: "text" as const, text: c.answer }] };
  });
}

async function answerOf(era: Era, answer: Answer | undefined) {
  const { client, asked } = await connect(era, answer, asking);
  const r = await client.callTool({ name: "ask", arguments: {} });
  return { text: (r.content as { text: string }[])[0]?.text, isError: r.isError, asked };
}

describe.each<Era>(["2025", "2026-07-28"])("confirm on the %s era", (era) => {
  it("does not ask a client without elicitation", async () => {
    expect(await answerOf(era, undefined)).toEqual({
      text: "unasked",
      isError: undefined,
      asked: [],
    });
  });

  it("asks with one required boolean, and a ticked box is yes", async () => {
    const { text, asked } = await answerOf(era, { action: "accept", content: { confirm: true } });
    expect(text).toBe("yes");
    expect(asked).toEqual([
      expect.objectContaining({
        message: "Delete it? Confirm?",
        requestedSchema: expect.objectContaining({
          type: "object",
          properties: { confirm: expect.objectContaining({ type: "boolean" }) },
          required: ["confirm"],
        }),
      }),
    ]);
  });

  it.each<Answer>([
    { action: "decline" },
    { action: "cancel" },
    { action: "accept", content: { confirm: false } },
    { action: "accept", content: { confirm: "yes" } },
    { action: "accept", content: {} },
    { action: "accept" },
  ])("takes %j as no", async (answer) => {
    const { text, asked } = await answerOf(era, answer);
    expect(text).toBe("no");
    expect(asked).toHaveLength(1);
  });
});

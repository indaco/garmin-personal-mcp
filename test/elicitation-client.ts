import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

/** What the client answers to the form; undefined: the client has no elicitation capability. */
export type Answer = {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, string | number | boolean | string[]>;
};

export type Era = "2025" | "2026-07-28";

const closers: (() => Promise<void>)[] = [];

/** Closes every connection that `connect` opened; call it in `afterEach`. */
export async function closeAll(): Promise<void> {
  for (const close of closers.splice(0)) await close();
}

/**
 * A client of the given era, connected through `serveStdio` (the production entry) to a server
 * that `register` fills. `asked` collects each form the client was shown.
 */
export async function connect(
  era: Era,
  answer: Answer | undefined,
  register: (server: McpServer) => void,
): Promise<{ client: Client; asked: unknown[] }> {
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(
    () => {
      const server = new McpServer({ name: "t", version: "1" });
      register(server);
      return server;
    },
    { transport: serverEnd },
  );
  const client = new Client(
    { name: "t", version: "1" },
    {
      capabilities: answer ? { elicitation: { form: {} } } : {},
      ...(era === "2026-07-28" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {}),
    },
  );
  const asked: unknown[] = [];
  if (answer) {
    client.setRequestHandler("elicitation/create", async (request) => {
      asked.push(request.params);
      return answer;
    });
  }
  await client.connect(clientEnd);
  closers.push(async () => {
    await client.close();
    await handle.close();
  });
  return { client, asked };
}

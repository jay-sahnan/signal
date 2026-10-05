import { createHash } from "node:crypto";
/** MCP clients must supply a stable UUID. Web SDK calls already have durable IDs. */
export function toolOperationKey(
  source: string,
  explicit: string | undefined,
  toolCallId?: string,
) {
  if (explicit) return explicit;
  if (source !== "web" || !toolCallId) return null;
  const bytes = createHash("sha256")
    .update(toolCallId)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

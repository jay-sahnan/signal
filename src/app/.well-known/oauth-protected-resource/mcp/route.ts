import {
  metadataCorsOptionsRequestHandler,
  protectedResourceHandlerClerk,
} from "@clerk/mcp-tools/next";

const handler = protectedResourceHandlerClerk();
const corsHandler = metadataCorsOptionsRequestHandler();
export { handler as GET, corsHandler as OPTIONS };

import { clerkSetup } from "@clerk/testing/playwright";
import { config } from "dotenv";

config({ path: ".env.local" });

export default async function globalSetup() {
  await clerkSetup();
}

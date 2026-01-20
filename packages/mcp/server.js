import { startMCPServer } from "./baasix/index.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  startMCPServer().catch((error) => {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  });
}

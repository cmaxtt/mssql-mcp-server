import { spawn } from "child_process";
import path from "path";

// Path to the compiled MCP server
const serverPath = path.join(process.cwd(), "dist", "index.js");

// Spawn the MCP server process
const server = spawn("node", [serverPath], {
    env: process.env, // Inherit environment variables (including .env loaded ones if we load them)
    stdio: ["pipe", "pipe", "inherit"], // write to stdin, read from stdout, log stderr
});

// Helper to send a request
let msgId = 0;
function sendRequest(method: string, params?: any) {
    const request = {
        jsonrpc: "2.0",
        id: msgId++,
        method,
        params,
    };
    const str = JSON.stringify(request);
    server.stdin.write(str + "\n");
}

// Buffer to handle partial chunks
let buffer = "";

server.stdout.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep the last partial line

    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const response = JSON.parse(line);
            console.log(`[RESPONSE] ${response.id !== undefined ? `ID: ${response.id}` : "Notification"}`);
            if (response.result) {
                // print a summary of the result
                if (response.result.content) {
                    console.log("Content Preview:", response.result.content[0].text.substring(0, 200) + "...");
                } else {
                    console.log(JSON.stringify(response.result, null, 2));
                }
            } else if (response.error) {
                console.error("ERROR:", response.error);
            }
        } catch (e) {
            console.log("Received non-JSON:", line);
        }
    }
});

// Run sequence of tests
setTimeout(() => {
    console.log("Initializing...");
    sendRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0" }
    });
}, 1000);

setTimeout(() => {
    console.log("Listing Tools...");
    sendRequest("tools/list");
}, 2000);

setTimeout(() => {
    console.log("Listing Tables in dbo...");
    sendRequest("tools/call", { name: "list_tables", arguments: { schema: "dbo" } });
}, 3000);

setTimeout(() => {
    console.log("Describing tblInvoices...");
    sendRequest("tools/call", { name: "describe_table", arguments: { schema: "dbo", table: "tblInvoices" } });
}, 4000);

setTimeout(() => {
    console.log("Getting DDL for tblInvoices...");
    sendRequest("tools/call", { name: "get_ddl", arguments: { schema: "dbo", table: "tblInvoices" } });
}, 5000);


setTimeout(() => {
    console.log("Closing...");
    server.kill();
    process.exit(0);
}, 6000);

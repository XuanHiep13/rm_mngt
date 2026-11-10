import { createInterface, emitKeypressEvents } from "node:readline";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readConfig } from "../server/config.js";
import { mysqlDatabase } from "../server/db.js";
import { hashPassword } from "../server/crypto.js";
import { passwordRule } from "../server/auth.js";

function question(prompt: string) {
  return new Promise<string>((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}
function secretQuestion(prompt: string) {
  return new Promise<string>((resolve) => {
    process.stdout.write(prompt);
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let value = "";
    const handler = (char: string, key: { name?: string; ctrl?: boolean }) => {
      if (key?.ctrl && key.name === "c") process.exit(130);
      if (key?.name === "return") {
        process.stdin.setRawMode(false);
        process.stdin.removeListener("keypress", handler);
        process.stdin.pause();
        process.stdout.write("\n");
        resolve(value);
      } else if (key?.name === "backspace") value = value.slice(0, -1);
      else if (char && !key?.ctrl && !char.startsWith("\u001b")) value += char;
    };
    process.stdin.on("keypress", handler);
  });
}
let input: unknown;
if (process.argv.includes("--stdin")) {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  input = JSON.parse(raw);
} else {
  if (!process.stdin.isTTY)
    throw new Error(
      "Use an interactive terminal, or --stdin with a JSON object through stdin.",
    );
  const username = await question("Administrator username: "),
    displayName = await question("Display name: ");
  const password = await secretQuestion("Password (14+ characters, hidden): ");
  const repeated = await secretQuestion("Repeat password: ");
  if (password !== repeated) throw new Error("Passwords do not match.");
  input = { username, displayName, password };
}
const data = z
  .object({
    username: z
      .string()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
    displayName: z.string().min(1).max(120),
    password: passwordRule,
  })
  .parse(input);
const db = mysqlDatabase(readConfig());
try {
  const id = randomUUID(),
    hash = await hashPassword(data.password);
  await db.transaction(async (tx) => {
    await tx.execute(
      "INSERT INTO users (id,username,display_name,password_hash,role,created_at) VALUES (?,?,?,?,?,?)",
      [id, data.username, data.displayName, hash, "admin", Date.now()],
    );
    await tx.execute(
      "INSERT INTO audit_events (id,actor_id,actor_name,action,resource_id,source_ip,details,created_at) VALUES (?,?,?,?,?,?,?,?)",
      [
        randomUUID(),
        id,
        data.username,
        "admin.bootstrapped",
        id,
        "local-cli",
        "{}",
        Date.now(),
      ],
    );
  });
  console.log(
    `Created administrator ${data.username}. MFA enrollment and a password change are required at first login.`,
  );
} finally {
  await db.close();
}

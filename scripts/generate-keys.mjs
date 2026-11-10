import { randomBytes } from "node:crypto";
console.log(
  "Save the following values in your private .env file. Do not commit them.",
);
console.log(`ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`);
console.log(`MYSQL_PASSWORD=${randomBytes(24).toString("hex")}`);
console.log(`MYSQL_ROOT_PASSWORD=${randomBytes(24).toString("hex")}`);

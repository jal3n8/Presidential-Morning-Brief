/**
 * npm run make-secret
 * Prints a new random automation token and the line to put in woi-config.php.
 * The token goes ONLY into the GitHub secret WOI_INGEST_TOKEN; the server keeps
 * only its SHA-256, so a leaked config file does not reveal the token.
 */
import { createHash, randomBytes } from "node:crypto";

const token = randomBytes(32).toString("base64url");
const salt = randomBytes(24).toString("base64url");
console.log("\n1) GitHub secret WOI_INGEST_TOKEN (copy exactly, then clear this window):\n");
console.log(`   ${token}\n`);
console.log("2) Lines for woi-config.php on Hostinger:\n");
console.log(`   'ingest_token_sha256' => '${createHash("sha256").update(token).digest("hex")}',`);
console.log(`   'log_salt' => '${salt}',\n`);

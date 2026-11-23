// Runs a Python script with whichever Python 3.9+ is installed (python3, python or the Windows "py" launcher).
import { spawnSync } from "node:child_process";

const candidates = process.platform === "win32" ? [["py", ["-3"]], ["python", []], ["python3", []]] : [["python3", []], ["python", []]];
const args = process.argv.slice(2);
for (const [cmd, pre] of candidates) {
  const probe = spawnSync(cmd, [...pre, "-c", "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 3)"], { stdio: "ignore" });
  if (probe.error || probe.status === null) continue;
  if (probe.status === 3) {
    console.error(`${cmd} is older than Python 3.9. Please install a current Python from python.org.`);
    process.exit(1);
  }
  if (probe.status !== 0) continue;
  const r = spawnSync(cmd, [...pre, ...args], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
console.error("Python 3 was not found. Install it from https://www.python.org/downloads/ (on Windows tick 'Add python.exe to PATH').");
process.exit(1);

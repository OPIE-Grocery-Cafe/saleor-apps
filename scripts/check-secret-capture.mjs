import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const roots = ["apps/stripe/scripts", "apps/smtp/scripts"];
const violations = [];

for (const root of roots) {
  for (const file of await sourceFiles(root)) {
    const source = await readFile(file, "utf8");
    if (/includeLocalVariables\s*:\s*true/.test(source)) {
      violations.push(`${file}: local-variable capture is forbidden in persistence/migration scripts`);
    }
    if (/Sentry\.init\s*\(/.test(source) && !/beforeSend\s*:\s*scrubSensitiveEventData/.test(source)) {
      violations.push(`${file}: Sentry initialization must use scrubSensitiveEventData`);
    }
  }
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.info("Secret-capture static check passed");

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if ([".ts", ".tsx", ".js", ".mjs"].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

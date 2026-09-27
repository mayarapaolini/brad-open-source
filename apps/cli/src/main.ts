import { run } from "./commands";

const code = await run(process.argv.slice(2), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
  // `pnpm brad` runs from apps/cli; INIT_CWD is where the owner typed the command.
  cwd: process.env.INIT_CWD ?? process.cwd(),
});
process.exit(code);

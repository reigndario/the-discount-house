import { run } from "./cli";

const { code, output } = run(process.argv.slice(2));
process.stdout.write(JSON.stringify(output, null, 2) + "\n");
process.exitCode = code;

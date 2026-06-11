#!/usr/bin/env node
// ecc-import-cli — fetch a public ECC skill and print its SFG registry stub to stdout.
//
// Sources: concept + first principles + public ECC specification (github.com/affaan-m/ECC README); zero files from any third-party skills-factory codebase (clean-room).
//
// Usage: node tools/ecc-import-cli.js <skill-name>
//   Fetches skills/<skill-name>/SKILL.md from the public ECC library, parses it, and prints the
//   conservative registry stub (disabled, owner 'imported-ecc') as JSON. The stub is a STARTING
//   POINT an operator reviews and completes — see `_importNotes` for fields to fill in.

import { fetchEccSkill, eccEntryToRegistryStub } from '../src/adapters/ecc-import.js';

async function main(argv) {
  const skillName = argv[2];
  if (!skillName || skillName.startsWith('-')) {
    process.stderr.write('usage: node tools/ecc-import-cli.js <skill-name>\n');
    return 2;
  }
  const parsed = await fetchEccSkill(skillName);
  const stub = eccEntryToRegistryStub(parsed);
  process.stdout.write(`${JSON.stringify({ [parsed.name ?? skillName]: stub }, null, 2)}\n`);
  return 0;
}

main(process.argv)
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`ecc-import-cli: ${err.message}\n`);
    process.exit(1);
  });

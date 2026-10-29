// Usage: node backend/scripts/migrateData.js old.json migrated.json
// Never overwrite the source or an existing destination.
const fs = require('node:fs/promises');
const model = require('../../shared/state-model');
async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Provide input and a new output JSON path.');
  const data = model.read(JSON.parse(await fs.readFile(input, 'utf8')));
  await fs.writeFile(output, JSON.stringify(model.write(data), null, 2), { encoding: 'utf8', flag: 'wx' });
  console.log('Migrated to schemaVersion ' + model.schemaVersion);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

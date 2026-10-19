const { mutationCommands, commandStorage } = require('./mutation');
const { createNote } = require('../validators/operations');
function createService(repository) {
  const { readData, saveData } = commandStorage(repository);
  async function getNotes() { return (await readData()).calendarNotes; }
  async function create(body) {
    const data = await readData();
    const note = createNote(data, body); data.calendarNotes.push(note);
    await saveData(data); return note;
  }
  return { getNotes, ...mutationCommands(repository, { createNote: create }) };
}
module.exports = { createService };

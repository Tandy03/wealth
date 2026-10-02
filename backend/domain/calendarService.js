const { BASE_CURRENCY, normalizeNumber, createId } = require("../utils/values");
const { isValidDateString } = require("../validators");
const { DomainError } = require("../utils/domainError");
const { validateRequest } = require('../validators/requests');
function createService(repository) {
    const { saveData } = repository;
    const readData = require('./readState').createStateReader(repository);
    async function getNotes() {
        const data = await readData();
        return data.calendarNotes;
    }
    async function createNote(body = {}) {
        validateRequest('note', body);
        const data = await readData();
        const date = body.date;
        const assetId = body.assetId;
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!isValidDateString(date)) {
            throw new DomainError({
                error: "Valid note date is required.",
            }, 400);
        }
        if (!assetId) {
            throw new DomainError({
                error: "Asset is required.",
            }, 400);
        }
        if (!text) {
            throw new DomainError({
                error: "Note text is required.",
            }, 400);
        }
        const asset = data.assets.find((item) => item.id === assetId);
        if (!asset) {
            throw new DomainError({
                error: "Asset not found.",
            }, 404);
        }
        const note = {
            id: createId("note"),
            createdAt: new Date().toISOString(),
            date,
            assetId,
            assetName: asset.name,
            text,
            amount: normalizeNumber(body.amount),
            currency: BASE_CURRENCY,
        };
        data.calendarNotes.push(note);
        await saveData(data);
        return note;
    }
    return { getNotes, createNote: (...args) => repository.runMutation(() => createNote(...args)) };
}
module.exports = { createService };

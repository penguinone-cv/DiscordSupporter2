import { writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import stringify from 'csv-stringify/lib/sync.js';
import csvLoader, { validateExamples } from '../utils/csvLoader.js';
import recruitmentDetector from './recruitmentDetector.js';
import { examplePath } from './recruitmentExamplePath.js';
export { examplePath } from './recruitmentExamplePath.js';

export function saveExamples(data) {
    const records = validateExamples(data);
    const destination = examplePath();
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
        writeFileSync(temporary, stringify(records, {
            header: true, columns: ['message', 'is_recruitment', 'reason']
        }), { encoding: 'utf8', flag: 'wx' });
        // Validate serialized data before replacing the file or the in-memory snapshot.
        const verified = csvLoader.load(temporary);
        renameSync(temporary, destination);
        recruitmentDetector.trainingData = verified;
        return verified;
    } finally {
        try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
}

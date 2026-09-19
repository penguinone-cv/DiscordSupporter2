import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import config from '../../src/config/configLoader.js';
import webServer from '../../src/services/webServer.js';
import detector from '../../src/services/recruitmentDetector.js';
import { saveExamples } from '../../src/services/recruitmentExampleStore.js';
import csvLoader from '../../src/utils/csvLoader.js';
import { renameSync } from 'node:fs';
vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal();
    return { ...actual, renameSync: vi.fn(actual.renameSync) };
});
let dir;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; config.config = null; vi.restoreAllMocks(); });
function setup() {
    dir = mkdtempSync(join(tmpdir(), 'recruitment-examples-'));
    const csvPath = join(dir, 'examples.csv');
    config.config = { features: { recruitmentDetection: { csvPath } }, activity: { enabled: false } };
    writeFileSync(csvPath, 'message,is_recruitment,reason\nold,false,\n');
    detector.reload();
    webServer.initialize();
    return csvPath;
}
describe('Example save transaction and API', () => {
    it('saves validated examples and reloads them without restart', async () => {
        const csvPath = setup();
        const data = [{ message: 'new, message', is_recruitment: 'true', reason: '' }];
        expect((await request(webServer.app).post('/api/csv').send({ data })).status).toBe(200);
        expect(detector.trainingData).toEqual(data);
        expect(readFileSync(csvPath, 'utf8')).toContain('"new, message",true,');
        expect((await request(webServer.app).get('/api/csv')).body.data).toEqual(data);
        expect(readdirSync(dir)).toEqual(['examples.csv']);
    });
    it('rejects conflicting labels without altering file or memory', async () => {
        const csvPath = setup();
        const before = readFileSync(csvPath, 'utf8');
        const response = await request(webServer.app).post('/api/csv').send({ data: [
            { message: 'same', is_recruitment: 'true' }, { message: 'same', is_recruitment: 'false' }
        ] });
        expect(response.status).toBe(400);
        expect(response.body.error).toContain('矛盾');
        expect(readFileSync(csvPath, 'utf8')).toBe(before);
        expect(detector.trainingData[0].message).toBe('old');
    });
    it('write failure preserves existing snapshot', () => {
        const csvPath = setup();
        config.config.features.recruitmentDetection.csvPath = join(dir, 'missing', 'examples.csv');
        expect(() => saveExamples([{ message: 'new', is_recruitment: 'true' }])).toThrow();
        expect(detector.trainingData[0].message).toBe('old');
        expect(readFileSync(csvPath, 'utf8')).toContain('old,false');
    });
    it.each(['verify', 'rename'])('%s failure preserves both the file and live examples and cleans temporary data', phase => {
        const csvPath = setup();
        const before = readFileSync(csvPath, 'utf8');
        if (phase === 'verify') vi.spyOn(csvLoader, 'load').mockImplementationOnce(() => { throw new Error('read failure'); });
        else renameSync.mockImplementationOnce(() => { throw new Error('rename failure'); });
        expect(() => saveExamples([{ message: 'new', is_recruitment: 'true' }])).toThrow('failure');
        expect(detector.trainingData[0].message).toBe('old');
        expect(readFileSync(csvPath, 'utf8')).toBe(before);
        expect(readdirSync(dir)).toEqual(['examples.csv']);
    });
});

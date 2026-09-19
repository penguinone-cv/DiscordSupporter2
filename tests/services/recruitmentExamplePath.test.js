import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import config from '../../src/config/configLoader.js';
import { examplePath } from '../../src/services/recruitmentExamplePath.js';
import { saveExamples } from '../../src/services/recruitmentExampleStore.js';
const directories = [];
afterEach(() => { directories.forEach(dir => rmSync(dir, { recursive: true, force: true })); directories.length = 0; vi.unstubAllEnvs(); config.config = null; });
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'recruitment-migration-')); directories.push(dir); return dir; };
describe('Docker example migration', () => {
    it('seeds once from the legacy file, saves in the directory volume and never overwrites saved examples', () => {
        const dir = directory();
        vi.stubEnv('RECRUITMENT_EXAMPLES_DIRECTORY', dir);
        config.config = { features: { recruitmentDetection: { csvPath: './recruitment_data.csv' } } };
        const source = readFileSync('recruitment_data.csv', 'utf8');
        const destination = examplePath();
        expect(destination).toBe(join(dir, 'recruitment_data.csv'));
        expect(readFileSync(destination, 'utf8')).toBe(source);
        saveExamples([{ message: 'changed', is_recruitment: 'false', reason: '' }]);
        expect(examplePath()).toBe(destination);
        expect(readFileSync(destination, 'utf8')).toContain('changed,false');
        expect(readFileSync('recruitment_data.csv', 'utf8')).toBe(source);
    });
    it('does not override an explicit custom CSV path', () => {
        const dir = directory();
        vi.stubEnv('RECRUITMENT_EXAMPLES_DIRECTORY', dir);
        const custom = join(dir, 'custom.csv');
        writeFileSync(custom, 'message,is_recruitment,reason\n');
        config.config = { features: { recruitmentDetection: { csvPath: custom } } };
        expect(examplePath()).toBe(custom);
    });
});

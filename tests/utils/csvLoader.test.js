import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import csvLoader, { validateExamples } from '../../src/utils/csvLoader.js';
vi.mock('fs', () => ({ readFileSync: vi.fn() }));
const row = (message = '一緒に遊ぼう', label = 'true') => ({ message, is_recruitment: label, reason: '' });
describe('CSV examples', () => {
    it('parses BOM, quotes and optional blank reason', () => {
        readFileSync.mockReturnValue('\uFEFFmessage,is_recruitment,reason\n"Apex,一緒にやろう",true,\n');
        expect(csvLoader.load('/data.csv')).toEqual([row('Apex,一緒にやろう')]);
    });
    it.each([null, [row(' ')], [row('x', 'TRUE')], [{ ...row(), reason: 1 }], [row('x'.repeat(2001))], Array.from({ length: 33 }, (_, i) => row(String(i))), Array.from({ length: 9 }, (_, i) => row(String(i) + 'x'.repeat(1999)))])('rejects invalid or oversized dataset', data => {
        expect(() => validateExamples(data)).toThrow();
    });
    it('rejects normalized duplicates and contradictory labels', () => {
        expect(() => validateExamples([row('ＡＢＣ'), row('abc')])).toThrow('重複');
        expect(() => validateExamples([row('hello'), row('hello', 'false')])).toThrow('矛盾');
    });
    it.each(['', 'wrong,header\n', 'message,message,is_recruitment\n'])('rejects invalid headers without clearing examples', csv => {
        readFileSync.mockReturnValue(csv);
        expect(() => csvLoader.load('/bad')).toThrow('ヘッダー');
    });
    it('allows a valid header-only CSV to explicitly clear examples', () => {
        readFileSync.mockReturnValue('message,is_recruitment,reason\n');
        expect(csvLoader.load('/empty')).toEqual([]);
    });
    it('propagates read and parse failures so caller can preserve previous data', () => {
        readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
        expect(() => csvLoader.load('/missing')).toThrow('ENOENT');
        readFileSync.mockReturnValue('message,is_recruitment,reason\n"unclosed,true,x');
        expect(() => csvLoader.load('/bad')).toThrow();
    });
});

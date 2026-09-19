import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../src/utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('../../src/services/recruitmentClassifier.js', () => ({ classifyRecruitment: vi.fn() }));
vi.mock('../../src/utils/csvLoader.js', () => ({ default: { load: vi.fn() } }));
vi.mock('fs', () => ({ appendFileSync: vi.fn(), existsSync: vi.fn().mockReturnValue(true), writeFileSync: vi.fn(), mkdirSync: vi.fn() }));
import config from '../../src/config/configLoader.js';
import detector from '../../src/services/recruitmentDetector.js';
import { classifyRecruitment } from '../../src/services/recruitmentClassifier.js';
import csvLoader from '../../src/utils/csvLoader.js';
import { appendFileSync, existsSync, writeFileSync } from 'fs';
beforeEach(() => {
    config.config = { features: { recruitmentDetection: { csvPath: './examples.csv', logPath: './log.csv' } } };
    detector.trainingData = [];
});
describe('Recruitment detector', () => {
    it('defaults to OpenAI and keeps Japanese reason', async () => {
        classifyRecruitment.mockResolvedValue({ isRecruitment: true, reason: '募集です' });
        expect(await detector.detect('遊ぼう', { name: 'game' })).toEqual({ isRecruitment: true, reason: '募集です' });
        expect(classifyRecruitment).toHaveBeenCalledWith('openai', '遊ぼう', []);
        expect(appendFileSync.mock.calls[0][1]).toContain(',true,募集です\n');
    });
    it('Jev always writes an empty CSV reason, even with unexpected adapter reason', async () => {
        config.config.features.recruitmentDetection.provider = 'jev';
        classifyRecruitment.mockResolvedValue({ isRecruitment: false, reason: 'must not leak', probability: 0.1 });
        expect(await detector.detect('hello', { name: 'game' })).toEqual({ isRecruitment: false, reason: '' });
        expect(appendFileSync.mock.calls[0][1]).toMatch(/,false,\n$/);
    });
    it.each(['openai', 'jev'])('API errors suppress notification and do not become negative examples: %s', async provider => {
        config.config.features.recruitmentDetection.provider = provider;
        classifyRecruitment.mockRejectedValue(new Error('API failure'));
        const result = await detector.detect('x', {});
        expect(result.isRecruitment).toBe(false);
        expect(result.reason).toBe(provider === 'jev' ? '' : 'エラーが発生したため判定できませんでした');
        expect(appendFileSync).not.toHaveBeenCalled();
    });
    it('reload failure retains last valid examples, successful empty CSV clears them', () => {
        const examples = [{ message: 'x', is_recruitment: 'true', reason: '' }];
        csvLoader.load.mockReturnValue(examples);
        expect(detector.reload()).toBe(true);
        csvLoader.load.mockImplementation(() => { throw new Error('bad CSV'); });
        expect(detector.reload()).toBe(false);
        expect(detector.trainingData).toEqual(examples);
        csvLoader.load.mockReturnValue([]);
        detector.reload();
        expect(detector.trainingData).toEqual([]);
    });
    it('writes existing CSV schema and escapes commas, quotes and newlines', () => {
        existsSync.mockReturnValue(false);
        detector.appendToLog('hello,"world"\nnext', true, '', 'game');
        expect(writeFileSync.mock.calls[0][1]).toBe('timestamp,channel,message,is_recruitment,reason\n');
        expect(appendFileSync.mock.calls[0][1]).toContain('"hello,""world""\nnext",true,\n');
    });
});

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import csvLoader from '../../src/utils/csvLoader.js';

vi.mock('fs', () => ({ readFileSync: vi.fn() }));
vi.mock('../../src/utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn() }
}));

describe('CSVLoader', () => {
    it('実際のCSVを解析し、募集と非募集の参考例を区別する', () => {
        readFileSync.mockReturnValue([
            'message,is_recruitment,reason',
            '"Apex,一緒にやろう",true,参加者募集',
            '',
            '今日は休み,false,日常の報告'
        ].join('\n'));

        const records = csvLoader.load('/examples.csv');
        expect(records).toEqual([
            { message: 'Apex,一緒にやろう', is_recruitment: 'true', reason: '参加者募集' },
            { message: '今日は休み', is_recruitment: 'false', reason: '日常の報告' }
        ]);
        const [positive, negative] = csvLoader.formatRecruitmentContext(records)
            .split('【募集メッセージではない例】');
        expect(positive).toContain('Apex,一緒にやろう');
        expect(positive).toContain('参加者募集');
        expect(positive).not.toContain('今日は休み');
        expect(negative).toContain('今日は休み');
        expect(negative).toContain('日常の報告');
        expect(negative).not.toContain('Apex,一緒にやろう');
    });

    it('ファイルを読めない場合は参考例なしで継続する', () => {
        readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
        expect(csvLoader.load('/missing.csv')).toEqual([]);
    });

    it('壊れたCSVの場合は参考例なしで継続する', () => {
        readFileSync.mockReturnValue('message,is_recruitment,reason\n"unclosed,true,reason');
        expect(csvLoader.load('/invalid.csv')).toEqual([]);
    });
});

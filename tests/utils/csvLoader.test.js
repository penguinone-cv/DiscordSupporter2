import { describe, it, expect, vi, beforeEach } from 'vitest';

// logger をモック
vi.mock('../../src/utils/logger.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

// fs をモック
vi.mock('fs', () => ({
    readFileSync: vi.fn(),
}));

// csv-parse/sync をモック
vi.mock('csv-parse/sync', () => ({
    parse: vi.fn(),
}));

let csvLoader;
let readFileSync;
let parse;

beforeEach(async () => {
    vi.resetModules();

    // モジュール再取得
    const fsMod = await import('fs');
    readFileSync = fsMod.readFileSync;

    const csvParseMod = await import('csv-parse/sync');
    parse = csvParseMod.parse;

    const mod = await import('../../src/utils/csvLoader.js');
    csvLoader = mod.default;
});

describe('CSVLoader', () => {
    describe('load()', () => {
        it('正規CSVファイルを正しく読み込む', () => {
            const mockRecords = [
                { message: 'Apex一緒にやりませんか', is_recruitment: 'true', reason: '募集' },
                { message: '疲れた', is_recruitment: 'false', reason: '日常' },
            ];
            readFileSync.mockReturnValue('csv-content');
            parse.mockReturnValue(mockRecords);

            const result = csvLoader.load('/path/to/test.csv');

            expect(readFileSync).toHaveBeenCalledWith('/path/to/test.csv', 'utf-8');
            expect(parse).toHaveBeenCalledWith('csv-content', {
                columns: true,
                skip_empty_lines: true,
                trim: true,
            });
            expect(result).toEqual(mockRecords);
        });

        it('存在しないファイルで空配列を返す', () => {
            readFileSync.mockImplementation(() => {
                const error = new Error('ENOENT');
                error.code = 'ENOENT';
                throw error;
            });

            const result = csvLoader.load('/nonexistent.csv');

            expect(result).toEqual([]);
        });

        it('パースエラーで空配列を返す', () => {
            readFileSync.mockReturnValue('invalid csv');
            parse.mockImplementation(() => {
                throw new Error('Parse error');
            });

            const result = csvLoader.load('/invalid.csv');

            expect(result).toEqual([]);
        });
    });

    describe('formatRecruitmentContext()', () => {
        it('募集/非募集レコードを正しくフォーマットする', () => {
            const records = [
                { message: '一緒にやろう', is_recruitment: 'true', reason: '募集している' },
                { message: '疲れた', is_recruitment: 'false', reason: '日常報告' },
            ];

            const result = csvLoader.formatRecruitmentContext(records);

            expect(result).toContain('募集メッセージの例');
            expect(result).toContain('一緒にやろう');
            expect(result).toContain('募集している');
            expect(result).toContain('募集メッセージではない例');
            expect(result).toContain('疲れた');
            expect(result).toContain('日常報告');
        });

        it('空配列で基本構造のみを返す', () => {
            const result = csvLoader.formatRecruitmentContext([]);

            expect(result).toContain('募集メッセージの例');
            expect(result).toContain('募集メッセージではない例');
        });

        it('募集メッセージのみの場合も正しくフォーマットする', () => {
            const records = [
                { message: 'Apex募集', is_recruitment: 'true', reason: 'ゲーム募集' },
            ];

            const result = csvLoader.formatRecruitmentContext(records);

            expect(result).toContain('Apex募集');
            expect(result).toContain('ゲーム募集');
        });
    });
});

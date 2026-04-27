import { describe, it, expect, vi, beforeEach } from 'vitest';

// 依存モジュールをモック
vi.mock('../../src/utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/config/configLoader.js', () => ({
    default: { get: vi.fn() },
}));

vi.mock('../../src/services/openaiService.js', () => ({
    default: { chatJSON: vi.fn() },
}));

vi.mock('../../src/utils/csvLoader.js', () => ({
    default: { load: vi.fn().mockReturnValue([]), formatRecruitmentContext: vi.fn().mockReturnValue('') },
}));

vi.mock('fs', () => ({
    appendFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
}));

import recruitmentDetector from '../../src/services/recruitmentDetector.js';
import openaiService from '../../src/services/openaiService.js';
import csvLoader from '../../src/utils/csvLoader.js';
import config from '../../src/config/configLoader.js';
import { appendFileSync, existsSync, writeFileSync } from 'fs';

describe('RecruitmentDetector', () => {
    describe('reload()', () => {
        it('CSVパスが設定されていない場合は何もしない', () => {
            config.get.mockReturnValue(undefined);

            recruitmentDetector.reload();

            expect(csvLoader.load).not.toHaveBeenCalled();
        });

        it('CSVデータを読み込みコンテキスト文字列を生成する', () => {
            config.get.mockReturnValue('./recruitment_data.csv');
            const mockData = [{ message: 'test', is_recruitment: 'true', reason: 'test' }];
            csvLoader.load.mockReturnValue(mockData);
            csvLoader.formatRecruitmentContext.mockReturnValue('formatted context');

            recruitmentDetector.reload();

            expect(csvLoader.load).toHaveBeenCalled();
            expect(csvLoader.formatRecruitmentContext).toHaveBeenCalledWith(mockData);
            expect(recruitmentDetector.trainingData).toEqual(mockData);
            expect(recruitmentDetector.contextString).toBe('formatted context');
        });
    });

    describe('detect()', () => {
        beforeEach(() => {
            recruitmentDetector.contextString = 'テストコンテキスト';
        });

        it('募集メッセージと判定された場合の結果を返す', async () => {
            config.get.mockReturnValue('./test_log.csv');
            existsSync.mockReturnValue(true);
            openaiService.chatJSON.mockResolvedValue({
                isRecruitment: true,
                reason: 'ゲームの募集を呼びかけている',
            });

            const result = await recruitmentDetector.detect('Apex一緒にやりませんか？', { name: 'apex' });

            expect(result.isRecruitment).toBe(true);
            expect(result.reason).toBe('ゲームの募集を呼びかけている');
        });

        it('非募集メッセージと判定された場合の結果を返す', async () => {
            config.get.mockReturnValue('./test_log.csv');
            existsSync.mockReturnValue(true);
            openaiService.chatJSON.mockResolvedValue({
                isRecruitment: false,
                reason: '日常的な発言',
            });

            const result = await recruitmentDetector.detect('疲れた', { name: 'general' });

            expect(result.isRecruitment).toBe(false);
            expect(result.reason).toBe('日常的な発言');
        });

        it('OpenAI APIエラー時は非募集として返す', async () => {
            openaiService.chatJSON.mockRejectedValue(new Error('API Error'));

            const result = await recruitmentDetector.detect('テスト', { name: 'test' });

            expect(result.isRecruitment).toBe(false);
            expect(result.reason).toContain('エラー');
        });
    });

    describe('appendToLog()', () => {
        it('ログファイルが存在しない場合ヘッダーを作成してから追記する', () => {
            config.get.mockReturnValue('./recruitment_log.csv');
            existsSync.mockImplementation((path) => {
                if (path.endsWith('.csv')) return false;
                return true;
            });

            recruitmentDetector.appendToLog('テストメッセージ', true, 'テスト理由', 'general');

            expect(writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('recruitment_log.csv'),
                'timestamp,channel,message,is_recruitment,reason\n',
                'utf-8'
            );
            expect(appendFileSync).toHaveBeenCalled();
        });

        it('ログパスが設定されていない場合は何もしない', () => {
            config.get.mockReturnValue(undefined);

            recruitmentDetector.appendToLog('test', true, 'reason', 'channel');

            expect(appendFileSync).not.toHaveBeenCalled();
        });

        it('CSVエスケープが正しく行われる（カンマを含むメッセージ）', () => {
            config.get.mockReturnValue('./recruitment_log.csv');
            existsSync.mockReturnValue(true);

            recruitmentDetector.appendToLog('hello, world', true, '理由', 'general');

            const appendCall = appendFileSync.mock.calls[0][1];
            expect(appendCall).toContain('"hello, world"');
        });
    });
});

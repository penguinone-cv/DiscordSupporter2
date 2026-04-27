import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let Logger;

beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/utils/logger.js');
    Logger = mod.default;
});

describe('Logger', () => {
    describe('info()', () => {
        it('console.log を呼び出し [INFO] プレフィックスを含む', () => {
            const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
            Logger.info('テストメッセージ');

            expect(spy).toHaveBeenCalledOnce();
            const output = spy.mock.calls[0][0];
            expect(output).toContain('[INFO]');
            expect(output).toContain('テストメッセージ');
        });

        it('追加引数を渡す', () => {
            const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const extra = { key: 'value' };
            Logger.info('msg', extra);

            expect(spy).toHaveBeenCalledWith(expect.stringContaining('[INFO]'), extra);
        });
    });

    describe('error()', () => {
        it('console.error を呼び出し [ERROR] プレフィックスを含む', () => {
            const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
            Logger.error('エラー発生');

            expect(spy).toHaveBeenCalledOnce();
            const output = spy.mock.calls[0][0];
            expect(output).toContain('[ERROR]');
            expect(output).toContain('エラー発生');
        });
    });

    describe('warn()', () => {
        it('console.warn を呼び出し [WARN] プレフィックスを含む', () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            Logger.warn('警告メッセージ');

            expect(spy).toHaveBeenCalledOnce();
            const output = spy.mock.calls[0][0];
            expect(output).toContain('[WARN]');
            expect(output).toContain('警告メッセージ');
        });
    });

    describe('debug()', () => {
        it('DEBUG 環境変数が設定されている場合 console.debug を呼ぶ', () => {
            const originalDebug = process.env.DEBUG;
            process.env.DEBUG = 'true';

            const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
            Logger.debug('デバッグ情報');

            expect(spy).toHaveBeenCalledOnce();
            const output = spy.mock.calls[0][0];
            expect(output).toContain('[DEBUG]');
            expect(output).toContain('デバッグ情報');

            // 環境変数を元に戻す
            if (originalDebug === undefined) {
                delete process.env.DEBUG;
            } else {
                process.env.DEBUG = originalDebug;
            }
        });

        it('DEBUG 環境変数が未設定の場合 console.debug を呼ばない', () => {
            const originalDebug = process.env.DEBUG;
            delete process.env.DEBUG;

            const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
            Logger.debug('デバッグ情報');

            expect(spy).not.toHaveBeenCalled();

            // 環境変数を元に戻す
            if (originalDebug !== undefined) {
                process.env.DEBUG = originalDebug;
            }
        });
    });

    describe('タイムスタンプ', () => {
        it('ISO形式のタイムスタンプを含む', () => {
            const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
            Logger.info('タイムスタンプテスト');

            const output = spy.mock.calls[0][0];
            // ISO 8601形式のタイムスタンプパターン
            expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        });
    });
});

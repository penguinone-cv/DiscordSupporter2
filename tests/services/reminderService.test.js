import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 依存モジュールをモック
vi.mock('../../src/utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/services/openaiService.js', () => ({
    default: { chatJSON: vi.fn() },
}));

vi.mock('fs', () => ({
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
}));

let reminderService;
let openaiService;
let fs;

beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();

    const openaiMod = await import('../../src/services/openaiService.js');
    openaiService = openaiMod.default;

    const fsMod = await import('fs');
    fs = fsMod;

    const mod = await import('../../src/services/reminderService.js');
    reminderService = mod.default;
});

afterEach(() => {
    vi.useRealTimers();
    // タイマーをクリア
    for (const timer of reminderService.timers.values()) {
        clearTimeout(timer);
    }
    reminderService.reminders.clear();
    reminderService.timers.clear();
});

describe('ReminderService', () => {
    describe('extractDate()', () => {
        it('日付抽出に成功した場合 Date オブジェクトを返す（12:00固定）', async () => {
            openaiService.chatJSON.mockResolvedValue({
                hasDate: true,
                date: '2026-03-25',
                reason: '明日を指定',
            });

            const messageTimestamp = new Date('2026-03-24T10:00:00Z');
            const result = await reminderService.extractDate('明日リマインド', messageTimestamp);

            expect(result).toBeInstanceOf(Date);
            expect(result.getHours()).toBe(12);
            expect(result.getMinutes()).toBe(0);
            expect(result.getFullYear()).toBe(2026);
            expect(result.getMonth()).toBe(2); // 0-indexed: March = 2
            expect(result.getDate()).toBe(25);
        });

        it('日付が特定できない場合 null を返す', async () => {
            openaiService.chatJSON.mockResolvedValue({
                hasDate: false,
                date: null,
                reason: '日付表現なし',
            });

            const messageTimestamp = new Date('2026-03-24T10:00:00Z');
            const result = await reminderService.extractDate('こんにちは', messageTimestamp);

            expect(result).toBeNull();
        });

        it('API エラー時は null を返す', async () => {
            openaiService.chatJSON.mockRejectedValue(new Error('API Error'));

            const messageTimestamp = new Date('2026-03-24T10:00:00Z');
            const result = await reminderService.extractDate('テスト', messageTimestamp);

            expect(result).toBeNull();
        });
    });

    describe('createReminder()', () => {
        it('リマインドを作成しスケジュールと永続化を行う', async () => {
            fs.writeFileSync.mockImplementation(() => {});

            // 未来の日時を設定
            const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1時間後

            const data = {
                guildId: 'guild-1',
                channelId: 'channel-1',
                messageId: 'msg-1',
                originalContent: 'テストメッセージ',
                remindAt: futureDate.toISOString(),
                userId: 'user-1',
            };

            const result = await reminderService.createReminder(data);

            expect(result).toHaveProperty('id');
            expect(result.guildId).toBe('guild-1');
            expect(result.channelId).toBe('channel-1');
            expect(result.originalContent).toBe('テストメッセージ');

            // reminders Map に格納されていることを確認
            expect(reminderService.reminders.size).toBe(1);

            // タイマーが設定されていることを確認
            expect(reminderService.timers.size).toBe(1);

            // ファイルに保存されていることを確認
            expect(fs.writeFileSync).toHaveBeenCalled();
        });
    });

    describe('scheduleReminder()', () => {
        it('過去日時のリマインドはスケジュールしない', () => {
            const reminder = {
                id: 'test-id',
                remindAt: new Date(Date.now() - 1000).toISOString(), // 過去
            };

            reminderService.scheduleReminder(reminder);

            expect(reminderService.timers.has('test-id')).toBe(false);
        });

        it('未来日時のリマインドをスケジュールする', () => {
            const reminder = {
                id: 'test-id',
                remindAt: new Date(Date.now() + 60000).toISOString(), // 1分後
            };

            reminderService.scheduleReminder(reminder);

            expect(reminderService.timers.has('test-id')).toBe(true);
        });
    });

    describe('saveReminders()', () => {
        it('リマインドデータをJSONファイルに保存する', () => {
            fs.writeFileSync.mockImplementation(() => {});

            reminderService.reminders.set('id-1', {
                id: 'id-1',
                guildId: 'guild-1',
                channelId: 'ch-1',
                originalContent: 'test',
            });

            reminderService.saveReminders();

            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('"id-1"'),
                'utf-8'
            );
        });
    });

    describe('loadReminders()', () => {
        it('ファイルが存在しない場合は何もしない', () => {
            fs.existsSync.mockReturnValue(false);

            reminderService.loadReminders();

            expect(reminderService.reminders.size).toBe(0);
        });

        it('保存されたリマインドを読み込みスケジュールする', () => {
            const futureDate = new Date(Date.now() + 3600000).toISOString();
            const savedData = [
                {
                    id: 'saved-1',
                    guildId: 'guild-1',
                    channelId: 'ch-1',
                    messageId: 'msg-1',
                    originalContent: '保存テスト',
                    remindAt: futureDate,
                    userId: 'user-1',
                },
            ];

            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue(JSON.stringify(savedData));

            reminderService.loadReminders();

            expect(reminderService.reminders.size).toBe(1);
            expect(reminderService.reminders.get('saved-1').originalContent).toBe('保存テスト');
            expect(reminderService.timers.size).toBe(1);
        });

        it('JSON解析エラー時もクラッシュしない', () => {
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockReturnValue('invalid json');

            expect(() => reminderService.loadReminders()).not.toThrow();
        });
    });
});

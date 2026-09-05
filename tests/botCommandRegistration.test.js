import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REST, Routes } from 'discord.js';

vi.mock('../src/config/configLoader.js', () => ({
    default: { get: key => ({ 'discord.token': 'test-token', 'discord.clientId': 'app-1', 'activity.enabled': false })[key] }
}));
vi.mock('../src/utils/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import Bot from '../src/bot.js';
import voteCommand from '../src/commands/vote.js';
import gameAdminCommand from '../src/commands/gameAdmin.js';
import logger from '../src/utils/logger.js';

describe('global command registration', () => {
    let get, put;
    const route = Routes.applicationCommands('app-1');
    const managed = () => [voteCommand.data.toJSON(), gameAdminCommand.data.toJSON()];

    beforeEach(() => {
        get = vi.spyOn(REST.prototype, 'get').mockResolvedValue([]);
        put = vi.spyOn(REST.prototype, 'put').mockResolvedValue([]);
    });

    it('Portalの既存Entry Pointを全言語と設定付きで保持し、API読み取り専用項目を送信しない', async () => {
        const entryPoint = {
            id: 'command-id', application_id: 'app-1', guild_id: undefined, version: 'version-id',
            type: 4, name: 'Launch', description: 'Open the schedule', handler: 2,
            name_localizations: { ja: '予定表を開く' }, description_localizations: { ja: '月間予定カレンダー' },
            default_member_permissions: null, dm_permission: false, default_permission: true,
            nsfw: false, integration_types: [0], contexts: [0],
            name_localized: '予定表を開く', description_localized: '月間予定カレンダー',
            options: [], unexpected_server_field: 'must-not-be-sent'
        };
        get.mockResolvedValue([
            { type: 1, name: 'old-vote', id: 'old-command' }, entryPoint
        ]);

        await new Bot().registerSlashCommands();

        expect(get).toHaveBeenCalledWith(route, { query: new URLSearchParams({ with_localizations: 'true' }) });
        expect(put).toHaveBeenCalledWith(route, { body: [...managed(), {
            type: 4, name: 'Launch', description: 'Open the schedule', handler: 2,
            name_localizations: { ja: '予定表を開く' }, description_localizations: { ja: '月間予定カレンダー' },
            default_member_permissions: null, dm_permission: false, default_permission: true,
            nsfw: false, integration_types: [0], contexts: [0]
        }] });
        expect(get.mock.invocationCallOrder[0]).toBeLessThan(put.mock.invocationCallOrder[0]);
        expect(entryPoint).toHaveProperty('id', 'command-id');
    });

    it('Entry Pointがないときは推測作成せず既存の2コマンドを登録する', async () => {
        await new Bot().registerSlashCommands();

        expect(get).toHaveBeenCalledOnce();
        expect(put).toHaveBeenCalledWith(route, { body: managed() });
    });

    it('最小Entry PointのAPP_HANDLER設定を勝手に変更しない', async () => {
        get.mockResolvedValue([{ id: 'entry-id', type: 4, name: 'Custom launch', description: 'Open', handler: 1 }]);

        await new Bot().registerSlashCommands();

        expect(put).toHaveBeenCalledWith(route, { body: [...managed(), {
            type: 4, name: 'Custom launch', description: 'Open', handler: 1
        }] });
    });

    it('既存コマンド取得に失敗したら一括上書きを実行しない', async () => {
        const error = new Error('Discord is unavailable');
        get.mockRejectedValue(error);

        await new Bot().registerSlashCommands();

        expect(put).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith('スラッシュコマンド登録エラー:', error);
    });

    it('取得結果が不正な場合も一括上書きを実行しない', async () => {
        get.mockResolvedValue({ invalid: 'response' });

        await new Bot().registerSlashCommands();

        expect(put).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalled();
    });
});

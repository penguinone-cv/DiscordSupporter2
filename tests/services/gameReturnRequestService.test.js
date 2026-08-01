import { Collection } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import database from '../../src/repositories/database.js';
import gameRepository from '../../src/repositories/gameRepository.js';
import archiveRepository from '../../src/repositories/archiveRepository.js';
import gameInterestRepository from '../../src/repositories/gameInterestRepository.js';
import guildSettingsRepository from '../../src/repositories/guildSettingsRepository.js';
import gameReturnRequestService from '../../src/services/gameReturnRequestService.js';

describe('gameReturnRequestService', () => {
    let guild;
    let adminChannel;
    let alertMessage;
    let game;

    beforeEach(() => {
        database.close();
        database.initialize(':memory:');
        alertMessage = { id: 'alert-1', edit: vi.fn().mockResolvedValue(undefined) };
        adminChannel = {
            id: 'admin-1',
            isSendable: () => true,
            send: vi.fn().mockResolvedValue(alertMessage),
            messages: { fetch: vi.fn().mockResolvedValue(alertMessage) }
        };
        guild = {
            id: 'guild-1',
            name: 'Test Guild',
            channels: {
                cache: new Collection([[adminChannel.id, adminChannel]]),
                fetch: vi.fn().mockResolvedValue(adminChannel)
            }
        };
        guildSettingsRepository.upsert({
            guildId: guild.id,
            gameCategoryId: 'category-1',
            adminChannelId: adminChannel.id
        });
        guildSettingsRepository.setMemberPanelSettings(guild.id, {
            channelId: 'member-panel-1',
            restoreRequestThreshold: 2
        });
        game = gameRepository.registerChannel({
            guildId: guild.id,
            channelId: 'channel-1',
            channelName: 'apex',
            parentCategoryId: 'category-1'
        });
        const operation = archiveRepository.beginOperation({
            gameId: game.id,
            type: 'archive',
            userId: 'admin-1',
            snapshot: { channelId: 'channel-1', data: { name: 'apex' } }
        });
        archiveRepository.updateOperation(operation.id, {
            status: 'succeeded',
            phase: 'completed'
        });
        gameRepository.setArchived(game.id);
    });

    afterEach(() => {
        database.close();
    });

    it('設定人数に達したときだけ通知し、その後は同じ通知を更新する', async () => {
        await gameReturnRequestService.toggle({ guild, gameId: game.id, userId: 'user-1' });
        expect(adminChannel.send).not.toHaveBeenCalled();

        const second = await gameReturnRequestService.toggle({
            guild,
            gameId: game.id,
            userId: 'user-2'
        });
        expect(second.count).toBe(2);
        expect(adminChannel.send).toHaveBeenCalledTimes(1);
        expect(gameInterestRepository.findAlert(second.snapshotId)).toEqual(
            expect.objectContaining({ status: 'open', message_id: alertMessage.id })
        );

        await gameReturnRequestService.toggle({ guild, gameId: game.id, userId: 'user-3' });
        expect(adminChannel.send).toHaveBeenCalledTimes(1);
        expect(alertMessage.edit).toHaveBeenCalledTimes(1);
        expect(gameInterestRepository.findAlert(second.snapshotId).request_count).toBe(3);
    });

    it('見送り後は同じアーカイブ周期で再通知しない', async () => {
        await gameReturnRequestService.toggle({ guild, gameId: game.id, userId: 'user-1' });
        const second = await gameReturnRequestService.toggle({
            guild,
            gameId: game.id,
            userId: 'user-2'
        });

        const dismissed = gameReturnRequestService.dismiss(guild.id, second.snapshotId);
        expect(dismissed.alert.status).toBe('dismissed');
        expect(dismissed.payload.components).toEqual([]);

        await gameReturnRequestService.toggle({ guild, gameId: game.id, userId: 'user-3' });
        expect(adminChannel.send).toHaveBeenCalledTimes(1);
        expect(gameInterestRepository.findAlert(second.snapshotId).status).toBe('dismissed');
    });

    it('通知基準を下げた場合は再同期で既存の希望を通知する', async () => {
        guildSettingsRepository.setMemberPanelSettings(guild.id, {
            channelId: 'member-panel-1',
            restoreRequestThreshold: 5
        });
        await gameReturnRequestService.toggle({ guild, gameId: game.id, userId: 'user-1' });
        await gameReturnRequestService.toggle({ guild, gameId: game.id, userId: 'user-2' });
        expect(adminChannel.send).not.toHaveBeenCalled();

        guildSettingsRepository.setMemberPanelSettings(guild.id, {
            channelId: 'member-panel-1',
            restoreRequestThreshold: 2
        });
        await gameReturnRequestService.reconcileGuild(guild);

        expect(adminChannel.send).toHaveBeenCalledTimes(1);
    });
});

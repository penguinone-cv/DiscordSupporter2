import { Collection, PermissionFlagsBits, ChannelType } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import database from '../../src/repositories/database.js';
import gameRepository from '../../src/repositories/gameRepository.js';
import guildSettingsRepository from '../../src/repositories/guildSettingsRepository.js';
import archiveRepository from '../../src/repositories/archiveRepository.js';
import gameInterestRepository from '../../src/repositories/gameInterestRepository.js';
import gameArchiveService from '../../src/services/gameArchiveService.js';

function createGuildFixture({ failTopic = false } = {}) {
    const guild = {
        id: 'guild-1',
        name: 'Test Guild',
        roles: {
            everyone: { id: 'guild-1' },
            cache: new Collection()
        },
        members: {
            me: { permissions: { has: vi.fn().mockReturnValue(true) } },
            cache: new Collection()
        },
        channels: {
            cache: new Collection(),
            fetch: vi.fn(async id => guild.channels.cache.get(id) ?? null),
            create: vi.fn()
        }
    };
    const originalCategory = {
        id: 'category-active',
        name: 'ゲームチャンネル',
        type: ChannelType.GuildCategory,
        parentId: null
    };
    const archiveCategory = {
        id: 'category-archive',
        name: '休止中ゲーム',
        type: ChannelType.GuildCategory,
        parentId: null,
        permissionOverwrites: {
            set: vi.fn().mockResolvedValue(undefined)
        }
    };
    let shouldFailTopic = failTopic;
    const channel = {
        id: 'channel-1',
        name: 'apex',
        guild,
        parentId: originalCategory.id,
        rawPosition: 3,
        topic: '通常トピック',
        nsfw: false,
        rateLimitPerUser: 0,
        defaultAutoArchiveDuration: 1440,
        defaultThreadRateLimitPerUser: 0,
        permissionsLocked: true,
        manageable: true,
        permissionOverwrites: {
            cache: new Collection(),
            set: vi.fn().mockResolvedValue(undefined)
        },
        permissionsFor: vi.fn().mockReturnValue({
            has: vi.fn(permission => [
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageRoles
            ].includes(permission))
        }),
        setParent: vi.fn(async parentId => {
            channel.parentId = parentId;
            return channel;
        }),
        setTopic: vi.fn(async topic => {
            if (shouldFailTopic) {
                shouldFailTopic = false;
                throw new Error('topic update failed');
            }
            channel.topic = topic;
            return channel;
        }),
        edit: vi.fn(async options => {
            Object.assign(channel, options);
            return channel;
        }),
        setPosition: vi.fn().mockResolvedValue(undefined)
    };
    guild.channels.cache.set(originalCategory.id, originalCategory);
    guild.channels.cache.set(archiveCategory.id, archiveCategory);
    guild.channels.cache.set(channel.id, channel);
    return { guild, channel, originalCategory, archiveCategory };
}

describe('gameArchiveService', () => {
    beforeEach(() => {
        database.close();
        database.initialize(':memory:');
    });

    afterEach(() => {
        database.close();
    });

    function prepareGame(fixture) {
        guildSettingsRepository.upsert({
            guildId: fixture.guild.id,
            gameCategoryId: fixture.originalCategory.id,
            adminChannelId: 'admin-1'
        });
        archiveRepository.registerCategory(fixture.guild.id, fixture.archiveCategory.id, 1);
        return gameRepository.registerChannel({
            guildId: fixture.guild.id,
            channelId: fixture.channel.id,
            channelName: fixture.channel.name,
            parentCategoryId: fixture.originalCategory.id,
            activeFrom: '2026-01-01T00:00:00.000Z'
        });
    }

    it('チャンネルをソフトアーカイブして元の設定へ再稼働できる', async () => {
        const fixture = createGuildFixture();
        const game = prepareGame(fixture);

        await gameArchiveService.archive({ guild: fixture.guild, gameId: game.id, userId: 'admin-1' });
        expect(gameRepository.findById(game.id).lifecycle_status).toBe('archived');
        expect(fixture.channel.parentId).toBe(fixture.archiveCategory.id);
        expect(fixture.channel.setParent).toHaveBeenCalledWith(
            fixture.archiveCategory.id,
            expect.objectContaining({ lockPermissions: true })
        );

        await gameArchiveService.restore({ guild: fixture.guild, gameId: game.id, userId: 'admin-1' });
        expect(gameRepository.findById(game.id).lifecycle_status).toBe('active');
        expect(fixture.channel.parentId).toBe(fixture.originalCategory.id);
        expect(fixture.channel.topic).toBe('通常トピック');
    });

    it('Discord操作が途中失敗した場合は元の状態へロールバックする', async () => {
        const fixture = createGuildFixture({ failTopic: true });
        const game = prepareGame(fixture);

        await expect(gameArchiveService.archive({
            guild: fixture.guild,
            gameId: game.id,
            userId: 'admin-1'
        })).rejects.toThrow('topic update failed');

        expect(gameRepository.findById(game.id).lifecycle_status).toBe('active');
        expect(fixture.channel.parentId).toBe(fixture.originalCategory.id);
        const operation = database.connection().prepare(`
            SELECT * FROM game_archive_operations WHERE game_id = ? ORDER BY id DESC LIMIT 1
        `).get(game.id);
        expect(operation.status).toBe('rolled_back');
    });

    it('再稼働時に現在の復帰希望通知を解決済みにする', async () => {
        const fixture = createGuildFixture();
        const game = prepareGame(fixture);
        await gameArchiveService.archive({
            guild: fixture.guild,
            gameId: game.id,
            userId: 'admin-1'
        });
        const archived = gameInterestRepository.findCurrentArchivedGame(
            fixture.guild.id,
            game.id
        );
        gameInterestRepository.toggleRestoreRequest({
            guildId: fixture.guild.id,
            gameId: game.id,
            snapshotId: archived.archive_snapshot_id,
            userId: 'user-1'
        });
        gameInterestRepository.reserveAlert({
            snapshotId: archived.archive_snapshot_id,
            gameId: game.id,
            guildId: fixture.guild.id,
            adminChannelId: 'admin-1',
            count: 1
        });

        await gameArchiveService.restore({
            guild: fixture.guild,
            gameId: game.id,
            userId: 'admin-1'
        });

        expect(gameInterestRepository.findAlert(archived.archive_snapshot_id).status)
            .toBe('resolved');
        expect(gameInterestRepository.findCurrentArchivedGame(fixture.guild.id, game.id))
            .toBeNull();
    });
});

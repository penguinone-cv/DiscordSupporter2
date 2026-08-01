import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import database from '../../src/repositories/database.js';
import gameRepository from '../../src/repositories/gameRepository.js';
import activityRepository from '../../src/repositories/activityRepository.js';
import guildSettingsRepository from '../../src/repositories/guildSettingsRepository.js';

describe('ゲーム管理DB', () => {
    beforeEach(() => {
        database.close();
        database.initialize(':memory:');
    });

    afterEach(() => {
        database.close();
    });

    it('マイグレーションを一度だけ適用する', () => {
        database.runMigrations();
        const rows = database.connection()
            .prepare('SELECT version FROM schema_migrations ORDER BY version')
            .all();
        expect(rows.map(row => row.version)).toEqual([
            '001_game_registry.sql',
            '002_soft_archive.sql'
        ]);
    });

    it('同じチャンネルを再登録してもゲームを重複作成しない', () => {
        const first = gameRepository.registerChannel({
            guildId: 'guild-1',
            channelId: 'channel-1',
            channelName: 'apex',
            parentCategoryId: 'category-1',
            activeFrom: '2026-01-01T00:00:00.000Z'
        });
        const second = gameRepository.registerChannel({
            guildId: 'guild-1',
            channelId: 'channel-1',
            channelName: 'apex-renamed',
            parentCategoryId: 'category-1',
            activeFrom: '2026-01-01T00:00:00.000Z'
        });

        expect(second.id).toBe(first.id);
        expect(gameRepository.listByGuild('guild-1')).toHaveLength(1);
        expect(gameRepository.findByChannelId('channel-1').display_name).toBe('apex-renamed');
    });

    it('名前が同じでも異なるチャンネルは自動統合しない', () => {
        gameRepository.registerChannel({
            guildId: 'guild-1', channelId: 'channel-1', channelName: 'apex',
            parentCategoryId: 'category-1', activeFrom: '2026-01-01T00:00:00.000Z'
        });
        gameRepository.registerChannel({
            guildId: 'guild-1', channelId: 'channel-2', channelName: 'apex',
            parentCategoryId: 'category-1', activeFrom: '2026-01-01T00:00:00.000Z'
        });

        expect(gameRepository.listByGuild('guild-1')).toHaveLength(2);
    });

    it('活動確認済みで期限を超えたゲームだけを休眠候補にする', () => {
        guildSettingsRepository.upsert({
            guildId: 'guild-1', gameCategoryId: 'category-1', dormantAfterDays: 90
        });
        const game = gameRepository.registerChannel({
            guildId: 'guild-1', channelId: 'channel-1', channelName: 'apex',
            parentCategoryId: 'category-1', activeFrom: '2025-01-01T00:00:00.000Z'
        });

        expect(activityRepository.listDormantCandidates(
            'guild-1', '2026-01-01T00:00:00.000Z'
        )).toHaveLength(0);

        activityRepository.markReconciled('channel-1', { confirmed: true });
        expect(activityRepository.listDormantCandidates(
            'guild-1', '2026-01-01T00:00:00.000Z'
        ).map(row => row.id)).toEqual([game.id]);

        activityRepository.defer(game.id, '2027-01-01T00:00:00.000Z', 'admin-1');
        expect(activityRepository.listDormantCandidates(
            'guild-1', '2026-01-01T00:00:00.000Z'
        )).toHaveLength(0);
    });
});


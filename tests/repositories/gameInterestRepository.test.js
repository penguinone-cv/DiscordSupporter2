import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import database from '../../src/repositories/database.js';
import gameRepository from '../../src/repositories/gameRepository.js';
import archiveRepository from '../../src/repositories/archiveRepository.js';
import gameInterestRepository from '../../src/repositories/gameInterestRepository.js';

describe('gameInterestRepository', () => {
    beforeEach(() => {
        database.close();
        database.initialize(':memory:');
    });

    afterEach(() => {
        database.close();
    });

    function archiveGame({ channelId = 'channel-1', name = 'apex' } = {}) {
        const game = gameRepository.registerChannel({
            guildId: 'guild-1',
            channelId,
            channelName: name,
            parentCategoryId: 'category-1'
        });
        const operation = archiveRepository.beginOperation({
            gameId: game.id,
            type: 'archive',
            userId: 'admin-1',
            snapshot: { channelId, data: { name } }
        });
        archiveRepository.updateOperation(operation.id, {
            status: 'succeeded',
            phase: 'completed'
        });
        gameRepository.setArchived(game.id);
        return { game, snapshotId: operation.snapshot_id };
    }

    it('復帰希望を切り替え、登録時にはゲーム希望も保持する', () => {
        const { game, snapshotId } = archiveGame();

        const added = gameInterestRepository.toggleRestoreRequest({
            guildId: 'guild-1',
            gameId: game.id,
            snapshotId,
            userId: 'user-1'
        });
        expect(added).toEqual({ requested: true, count: 1 });
        expect(gameInterestRepository.hasRestoreRequest(snapshotId, 'user-1')).toBe(true);
        expect(database.connection().prepare(`
            SELECT * FROM user_game_preferences
            WHERE guild_id = ? AND user_id = ? AND game_id = ?
        `).get('guild-1', 'user-1', game.id)).toBeTruthy();

        const removed = gameInterestRepository.toggleRestoreRequest({
            guildId: 'guild-1',
            gameId: game.id,
            snapshotId,
            userId: 'user-1'
        });
        expect(removed).toEqual({ requested: false, count: 0 });
        expect(gameInterestRepository.hasRestoreRequest(snapshotId, 'user-1')).toBe(false);
        expect(database.connection().prepare(`
            SELECT * FROM user_game_preferences
            WHERE guild_id = ? AND user_id = ? AND game_id = ?
        `).get('guild-1', 'user-1', game.id)).toBeTruthy();
    });

    it('再アーカイブ時は新しい周期を0人から開始する', () => {
        const first = archiveGame();
        gameInterestRepository.toggleRestoreRequest({
            guildId: 'guild-1',
            gameId: first.game.id,
            snapshotId: first.snapshotId,
            userId: 'user-1'
        });
        archiveRepository.markSnapshotRestored(first.snapshotId);
        gameRepository.setActive(first.game.id);

        const operation = archiveRepository.beginOperation({
            gameId: first.game.id,
            type: 'archive',
            userId: 'admin-1',
            snapshot: { channelId: 'channel-1', data: { name: 'apex' } }
        });
        archiveRepository.updateOperation(operation.id, {
            status: 'succeeded',
            phase: 'completed'
        });
        gameRepository.setArchived(first.game.id);

        const current = gameInterestRepository.findCurrentArchivedGame(
            'guild-1',
            first.game.id
        );
        expect(current.archive_snapshot_id).toBe(operation.snapshot_id);
        expect(current.restore_request_count).toBe(0);
        expect(gameInterestRepository.hasRestoreRequest(first.snapshotId, 'user-1')).toBe(true);
    });

    it('同じアーカイブ周期の管理者通知を一度だけ確保する', () => {
        const { game, snapshotId } = archiveGame();
        const input = {
            snapshotId,
            gameId: game.id,
            guildId: 'guild-1',
            adminChannelId: 'admin-1',
            count: 5
        };

        expect(gameInterestRepository.reserveAlert(input)).toBe(true);
        expect(gameInterestRepository.reserveAlert(input)).toBe(false);
        expect(gameInterestRepository.dismissAlert('guild-1', snapshotId).status)
            .toBe('dismissed');
        expect(gameInterestRepository.resolveAlert(snapshotId).status).toBe('resolved');
    });
});

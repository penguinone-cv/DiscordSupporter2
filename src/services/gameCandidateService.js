import gameRepository from '../repositories/gameRepository.js';
import availabilityRepository from '../repositories/availabilityRepository.js';
import scheduleService from './scheduleService.js';

class GameCandidateService {
    listGames(guildId) {
        return gameRepository.listByGuild(guildId, 'active')
            .filter(game => game.current_channel_id);
    }

    async aggregate(guild, monthId, gameId) {
        const month = scheduleService.getMonth(guild.id, monthId);
        const game = gameRepository.findById(gameId);
        if (!game
            || game.guild_id !== guild.id
            || game.lifecycle_status !== 'active'
            || !game.current_channel_id) {
            throw new Error('対象の稼働中ゲームが見つかりません');
        }

        const members = await guild.members.fetch();
        const activeUserIds = new Set();
        for (const member of members.values()) {
            if (!member.user?.bot) activeUserIds.add(member.id ?? member.user.id);
        }

        // 月間画面をまだ開いていないユーザーも、登録済みの基本予定から集計する。
        // すでに月間予定がある日時枠はリポジトリ側の競合処理で上書きしない。
        availabilityRepository.materializeBasicForAllUsers(guild.id, month.id);

        const grouped = new Map();
        for (const row of availabilityRepository.listCandidateResponses(
            guild.id,
            month.id,
            game.id
        )) {
            if (!activeUserIds.has(row.user_id)) continue;
            if (!grouped.has(row.slot_id)) {
                grouped.set(row.slot_id, {
                    slotId: row.slot_id,
                    localDate: row.local_date,
                    label: row.label,
                    startMinutes: row.start_minutes,
                    endMinutes: row.end_minutes,
                    sortOrder: row.sort_order,
                    availableCount: 0,
                    maybeCount: 0,
                    includingMaybeCount: 0
                });
            }
            const aggregate = grouped.get(row.slot_id);
            if (row.status === 'available') aggregate.availableCount += 1;
            if (row.status === 'maybe') aggregate.maybeCount += 1;
            aggregate.includingMaybeCount = aggregate.availableCount + aggregate.maybeCount;
        }

        const candidates = [...grouped.values()]
            .filter(candidate => candidate.includingMaybeCount > 0)
            .sort((left, right) => (
                right.availableCount - left.availableCount
                || right.includingMaybeCount - left.includingMaybeCount
                || left.localDate.localeCompare(right.localDate)
                || left.sortOrder - right.sortOrder
                || left.slotId - right.slotId
            ));
        return { month, game, candidates };
    }
}

export default new GameCandidateService();

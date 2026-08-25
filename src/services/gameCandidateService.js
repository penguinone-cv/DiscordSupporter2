import gameRepository from '../repositories/gameRepository.js';
import availabilityRepository from '../repositories/availabilityRepository.js';
import scheduleService from './scheduleService.js';
import { currentDateKey } from '../utils/scheduleDate.js';

class GameCandidateService {
    constructor() {
        this.memberFetches = new Map();
    }

    listGames(guildId) {
        return gameRepository.listByGuild(guildId, 'active')
            .filter(game => game.current_channel_id);
    }

    async currentMembers(guild) {
        const manager = guild.members;
        const cached = manager?.cache;
        if (!cached || typeof manager.fetch !== 'function') {
            throw new Error('サーバーメンバーを取得できません');
        }

        if (Number.isInteger(guild.memberCount) && cached.size >= guild.memberCount) {
            return cached;
        }

        let pending = this.memberFetches.get(guild.id);
        if (!pending) {
            pending = manager.fetch()
                .finally(() => this.memberFetches.delete(guild.id));
            this.memberFetches.set(guild.id, pending);
        }
        return pending;
    }

    async aggregate(guild, monthId, gameId, now = new Date()) {
        const month = scheduleService.getMonth(guild.id, monthId);
        const game = gameRepository.findById(gameId);
        if (!game
            || game.guild_id !== guild.id
            || game.lifecycle_status !== 'active'
            || !game.current_channel_id) {
            throw new Error('対象の稼働中ゲームが見つかりません');
        }

        // 月間画面をまだ開いていないユーザーも、登録済みの基本予定から集計する。
        // すでに月間予定がある日時枠はリポジトリ側の競合処理で上書きしない。
        availabilityRepository.materializeBasicForAllUsers(guild.id, month.id);
        const members = await this.currentMembers(guild);
        const today = currentDateKey(now, month.timezone);

        const grouped = new Map();
        for (const row of availabilityRepository.listCandidateResponses(
            guild.id,
            month.id,
            game.id
        )) {
            if (row.local_date < today) continue;
            const member = members.get(row.user_id);
            if (!member || member.user?.bot !== false) continue;
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
                    unavailableCount: 0,
                    includingMaybeCount: 0
                });
            }
            const aggregate = grouped.get(row.slot_id);
            if (row.status === 'available') aggregate.availableCount += 1;
            if (row.status === 'maybe') aggregate.maybeCount += 1;
            if (row.status === 'unavailable') aggregate.unavailableCount += 1;
            aggregate.includingMaybeCount = aggregate.availableCount + aggregate.maybeCount;
        }

        const candidates = [...grouped.values()]
            .filter(candidate => candidate.includingMaybeCount > 0)
            .sort((left, right) => (
                left.localDate.localeCompare(right.localDate)
                || left.sortOrder - right.sortOrder
                || left.slotId - right.slotId
            ));
        return { month, game, candidates };
    }
}

export default new GameCandidateService();

import gameCandidateService from './gameCandidateService.js';
import scheduleService from './scheduleService.js';
import activityScheduleService from './activityScheduleService.js';
import gameRecruitmentService from './gameRecruitmentService.js';
import gameRecruitmentRepository from '../repositories/gameRecruitmentRepository.js';
import { currentDateKey } from '../utils/scheduleDate.js';

function fail(status, code, message) {
    throw Object.assign(new Error(message), { status, code });
}

const gameSummary = game => ({ id: game.id, displayName: game.display_name, channelId: game.current_channel_id });

class ActivityCandidateService {
    listGames(guild) {
        return { games: gameCandidateService.listGames(guild.id).map(gameSummary) };
    }

    assertGame(guild, gameId) {
        if (!gameCandidateService.listGames(guild.id).some(game => game.id === gameId)) {
            fail(404, 'game_not_found', '対象の稼働中ゲームが見つかりません。ゲームを選び直してください。');
        }
    }

    async getCandidates(guild, offset, gameId, now = new Date()) {
        if (![0, 1].includes(offset)) fail(400, 'invalid_month', '表示できるのは今月と翌月です');
        this.assertGame(guild, gameId);
        const month = scheduleService.getMonthByOffset(guild.id, offset, now);
        const result = await gameCandidateService.aggregate(guild, month.id, gameId, now);
        return {
            month: { id: month.id, year: month.year, month: month.month, timezone: month.timezone },
            today: currentDateKey(now, month.timezone),
            game: gameSummary(result.game),
            candidates: result.candidates.map(candidate => {
                const recruitment = gameRecruitmentRepository.findByGameSlot(gameId, candidate.slotId);
                return {
                    slotId: candidate.slotId, localDate: candidate.localDate, label: candidate.label,
                    availableCount: candidate.availableCount, maybeCount: candidate.maybeCount,
                    unavailableCount: candidate.unavailableCount, members: candidate.members,
                    recruitment: recruitment ? {
                        id: recruitment.id, status: recruitment.status,
                        messageId: recruitment.message_id, channelId: recruitment.channel_id
                    } : null
                };
            })
        };
    }

    async createRecruitment(args, now = new Date()) {
        activityScheduleService.validateMonth(args.guild.id, args.monthId, now);
        this.assertGame(args.guild, args.gameId);
        try {
            const { recruitment } = await gameRecruitmentService.createRecruitment(args);
            return { recruitmentId: recruitment.id, channelId: recruitment.channel_id, messageId: recruitment.message_id };
        } catch (error) {
            if (error.name === 'GameRecruitmentError') fail(409, 'recruitment_conflict', error.message);
            throw error;
        }
    }
}

export default new ActivityCandidateService();

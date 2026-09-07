import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/services/gameCandidateService.js', () => ({ default: { listGames: vi.fn(), aggregate: vi.fn() } }));
vi.mock('../../src/services/scheduleService.js', () => ({ default: { getMonthByOffset: vi.fn() } }));
vi.mock('../../src/services/activityScheduleService.js', () => ({ default: { validateMonth: vi.fn() } }));
vi.mock('../../src/services/gameRecruitmentService.js', () => ({ default: { createRecruitment: vi.fn() } }));
vi.mock('../../src/repositories/gameRecruitmentRepository.js', () => ({ default: { findByGameSlot: vi.fn() } }));
import candidates from '../../src/services/gameCandidateService.js';
import schedules from '../../src/services/scheduleService.js';
import activitySchedules from '../../src/services/activityScheduleService.js';
import recruitments from '../../src/services/gameRecruitmentService.js';
import repository from '../../src/repositories/gameRecruitmentRepository.js';
import service from '../../src/services/activityCandidateService.js';

describe('Activity candidate service', () => {
    const guild = { id: 'g' }, month = { id: 1, year: 2026, month: 9, timezone: 'Asia/Tokyo' };
    const game = { id: 2, display_name: 'Game', current_channel_id: 'channel' };
    beforeEach(() => {
        vi.resetAllMocks();
        candidates.listGames.mockReturnValue([game]);
        schedules.getMonthByOffset.mockReturnValue(month);
        activitySchedules.validateMonth.mockReturnValue(month);
        candidates.aggregate.mockResolvedValue({ month, game, candidates: [{ slotId: 3, localDate: '2026-09-07', label: '昼', availableCount: 1, maybeCount: 0, unavailableCount: 0, members: [{ userId: 'u', displayName: 'Name', status: 'available' }] }] });
        repository.findByGameSlot.mockReturnValue({ id: 4, status: 'open', message_id: 'm', channel_id: 'channel', creator_user_id: 'private' });
    });
    it('月のタイムゾーンと回答者を返し募集内部データを公開しない', async () => {
        const result = await service.getCandidates(guild, 0, 2, new Date('2026-09-06T15:00:00Z'));
        expect(result.today).toBe('2026-09-07');
        expect(result.candidates[0].members).toHaveLength(1);
        expect(result.candidates[0].recruitment).toEqual({ id: 4, status: 'open', messageId: 'm', channelId: 'channel' });
        expect(JSON.stringify(result)).not.toContain('private');
    });
    it('非稼働または別サーバーのゲームを拒否する', async () => {
        await expect(service.getCandidates(guild, 0, 9)).rejects.toMatchObject({ status: 404 });
        expect(candidates.aggregate).not.toHaveBeenCalled();
    });
    it('投稿前に対象月を検証し既存サービスに本人情報を渡す', async () => {
        const args = { guild, userId: 'self', monthId: 1, gameId: 2, slotId: 3 };
        recruitments.createRecruitment.mockResolvedValue({ recruitment: { id: 4, channel_id: 'channel', message_id: 'm' } });
        expect(await service.createRecruitment(args)).toEqual({ recruitmentId: 4, channelId: 'channel', messageId: 'm' });
        expect(recruitments.createRecruitment).toHaveBeenCalledWith(args);
        activitySchedules.validateMonth.mockImplementation(() => { throw Object.assign(new Error('対象外'), { status: 400 }); });
        recruitments.createRecruitment.mockClear();
        await expect(service.createRecruitment(args)).rejects.toMatchObject({ status: 400 });
        expect(recruitments.createRecruitment).not.toHaveBeenCalled();
    });
    it('募集競合を409に変換する', async () => {
        recruitments.createRecruitment.mockRejectedValue(Object.assign(new Error('すでに作成されています'), { name: 'GameRecruitmentError' }));
        await expect(service.createRecruitment({ guild, userId: 'self', monthId: 1, gameId: 2, slotId: 3 })).rejects.toMatchObject({ status: 409, code: 'recruitment_conflict' });
    });
});

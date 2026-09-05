import { Collection } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import guildMemberService from '../../src/services/guildMemberService.js';

function member(id, displayName, bot = false) {
    return {
        id,
        displayName,
        user: {
            id,
            bot,
            username: `${id}-username`
        }
    };
}

describe('guildMemberService', () => {
    beforeEach(() => {
        guildMemberService.clearPendingFetches();
    });

    it('完全なキャッシュから非Botメンバーだけを表示名とIDの安定順で返す', async () => {
        const members = new Collection([
            ['user-3', member('user-3', 'ペンギン')],
            ['bot-1', member('bot-1', '管理Bot', true)],
            ['user-2', member('user-2', 'あざらし')],
            ['user-1', member('user-1', 'あざらし')]
        ]);
        const guild = {
            id: 'guild-1',
            memberCount: members.size,
            members: {
                cache: members,
                fetch: vi.fn()
            }
        };

        const result = await guildMemberService.currentMembers(guild);

        expect(guild.members.fetch).not.toHaveBeenCalled();
        expect([...result.keys()]).toEqual(['user-1', 'user-2', 'user-3']);
        expect(result.get('user-3')).toEqual(expect.objectContaining({
            id: 'user-3',
            displayName: 'ペンギン'
        }));
        expect(result.has('bot-1')).toBe(false);
    });

    it('不完全なキャッシュをfetchで補完してから一覧を返す', async () => {
        const cachedMembers = new Collection([
            ['user-2', member('user-2', 'しろくま')]
        ]);
        const allMembers = new Collection([
            ...cachedMembers,
            ['user-1', member('user-1', 'あざらし')]
        ]);
        const guild = {
            id: 'guild-1',
            memberCount: allMembers.size,
            members: {
                cache: cachedMembers,
                fetch: vi.fn().mockResolvedValue(allMembers)
            }
        };

        const result = await guildMemberService.currentMembers(guild);

        expect(guild.members.fetch).toHaveBeenCalledOnce();
        expect([...result.keys()]).toEqual(['user-1', 'user-2']);
    });

    it('同じサーバーの同時取得ではメンバーfetchを共有する', async () => {
        const allMembers = new Collection([
            ['user-1', member('user-1', 'あざらし')]
        ]);
        let resolveFetch;
        const fetchResult = new Promise(resolve => {
            resolveFetch = resolve;
        });
        const guild = {
            id: 'guild-1',
            memberCount: allMembers.size,
            members: {
                cache: new Collection(),
                fetch: vi.fn().mockReturnValue(fetchResult)
            }
        };

        const first = guildMemberService.currentMembers(guild);
        const second = guildMemberService.currentMembers(guild);
        resolveFetch(allMembers);

        const [firstResult, secondResult] = await Promise.all([first, second]);
        expect(guild.members.fetch).toHaveBeenCalledOnce();
        expect([...firstResult.keys()]).toEqual(['user-1']);
        expect([...secondResult.keys()]).toEqual(['user-1']);
    });

    it('メンバーマネージャーを利用できない場合は明示的に失敗する', async () => {
        await expect(guildMemberService.currentMembers({
            id: 'guild-1',
            members: {}
        })).rejects.toThrow('サーバーメンバーを取得できません');
    });

    it('fetch失敗は伝播し、次回再取得できる', async () => {
        const all = new Collection([['user-1', member('user-1', 'あざらし')]]);
        const guild = { id: 'guild-1', memberCount: 1, members: {
            cache: new Collection(), fetch: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(all)
        } };
        await expect(guildMemberService.currentMembers(guild)).rejects.toThrow('offline');
        expect((await guildMemberService.currentMembers(guild)).size).toBe(1);
        expect(guild.members.fetch).toHaveBeenCalledTimes(2);
    });

    it('fetch後でも人数が不完全なら誤った集計を返さない', async () => {
        const partial = new Collection([['user-1', member('user-1', 'あざらし')]]);
        const guild = { id: 'guild-1', memberCount: 2, members: {
            cache: partial, fetch: vi.fn().mockResolvedValue(partial)
        } };
        await expect(guildMemberService.currentMembers(guild)).rejects.toThrow('サーバーメンバーを取得できません');
    });

    it('退会者を含み人数過多になったキャッシュも再取得する', async () => {
        const current = new Collection([['user-1', member('user-1', 'あざらし')]]);
        const guild = { id: 'guild-1', memberCount: 1, members: {
            cache: new Collection([...current, ['departed', member('departed', '退会者')]]),
            fetch: vi.fn().mockResolvedValue(current)
        } };
        expect([...(await guildMemberService.currentMembers(guild)).keys()]).toEqual(['user-1']);
        expect(guild.members.fetch).toHaveBeenCalledOnce();
    });
});

import { describe, expect, it } from 'vitest';
import { ActivitySessionService } from '../../src/services/activitySessionService.js';

describe('ActivitySessionService', () => {
    const now = () => new Date('2026-09-02T12:00:00.000Z');

    it('短期セッションを発行し、本人・guild・Activity instanceを復元する', () => {
        const service = new ActivitySessionService({
            secret: 'a'.repeat(32),
            ttlSeconds: 300,
            now
        });

        const token = service.issue({
            userId: 'user-1',
            guildId: 'guild-1',
            instanceId: 'instance-1'
        });

        expect(service.verify(token)).toEqual({
            userId: 'user-1',
            guildId: 'guild-1',
            instanceId: 'instance-1',
            issuedAt: Math.floor(now().getTime() / 1000),
            expiresAt: Math.floor(now().getTime() / 1000) + 300
        });
    });

    it('改ざんされたセッションを拒否する', () => {
        const service = new ActivitySessionService({ secret: 'b'.repeat(32), now });
        const token = service.issue({
            userId: 'user-1',
            guildId: 'guild-1',
            instanceId: 'instance-1'
        });
        const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

        expect(() => service.verify(tampered)).toThrow('Activityセッションが無効です');
    });

    it('期限切れセッションを拒否する', () => {
        let current = new Date('2026-09-02T12:00:00.000Z');
        const service = new ActivitySessionService({
            secret: 'c'.repeat(32),
            ttlSeconds: 60,
            now: () => current
        });
        const token = service.issue({
            userId: 'user-1',
            guildId: 'guild-1',
            instanceId: 'instance-1'
        });
        current = new Date('2026-09-02T12:01:01.000Z');

        expect(() => service.verify(token)).toThrow('Activityセッションの有効期限が切れています');
    });

    it('有効期限と同じ時刻にセッションを拒否する', () => {
        let current = now();
        const service = new ActivitySessionService({
            secret: 'c'.repeat(32), ttlSeconds: 60, now: () => current
        });
        const token = service.issue({ userId: 'user-1', guildId: 'guild-1', instanceId: 'instance-1' });
        current = new Date('2026-09-02T12:01:00.000Z');
        expect(() => service.verify(token)).toThrow('Activityセッションの有効期限が切れています');
    });

    it.each([null, '', 'a.b.c', 'a.b', 'a'.repeat(10000)])('不正形式を拒否する', token => {
        const service = new ActivitySessionService({ secret: 'c'.repeat(32), now });
        expect(() => service.verify(token)).toThrow('Activityセッションが無効です');
    });

    it('未来に発行されたセッションを拒否する', () => {
        let current = new Date('2026-09-02T12:01:00.000Z');
        const service = new ActivitySessionService({ secret: 'c'.repeat(32), now: () => current });
        const token = service.issue({ userId: 'user-1', guildId: 'guild-1', instanceId: 'instance-1' });
        current = now();
        expect(() => service.verify(token)).toThrow('Activityセッションが無効です');
    });

    it.each([
        { secret: '', message: 'Activityセッションの秘密値が設定されていません' },
        { secret: 'short', message: 'Activityセッションの秘密値は32文字以上にしてください' }
    ])('弱い秘密値を拒否する: $message', ({ secret, message }) => {
        expect(() => new ActivitySessionService({ secret, now })).toThrow(message);
    });

    it('必須の識別子が欠けたセッションを発行しない', () => {
        const service = new ActivitySessionService({ secret: 'd'.repeat(32), now });

        expect(() => service.issue({
            userId: 'user-1',
            guildId: '',
            instanceId: 'instance-1'
        })).toThrow('Activityセッション情報が不足しています');
    });
});

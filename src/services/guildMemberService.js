import { Collection } from 'discord.js';

const DISPLAY_NAME_COLLATOR = new Intl.Collator('ja', {
    numeric: true,
    sensitivity: 'base'
});

function memberDisplayName(member, fallbackId) {
    return member.displayName
        ?? member.nickname
        ?? member.user?.globalName
        ?? member.user?.username
        ?? fallbackId;
}

class GuildMemberService {
    constructor() {
        this.memberFetches = new Map();
    }

    clearPendingFetches() {
        this.memberFetches.clear();
    }

    async currentMembers(guild) {
        const manager = guild.members;
        const cached = manager?.cache;
        if (!cached || typeof manager.fetch !== 'function') {
            throw new Error('サーバーメンバーを取得できません');
        }

        let members = cached;
        if (!Number.isInteger(guild.memberCount) || cached.size !== guild.memberCount) {
            let pending = this.memberFetches.get(guild.id);
            if (!pending) {
                pending = manager.fetch()
                    .finally(() => this.memberFetches.delete(guild.id));
                this.memberFetches.set(guild.id, pending);
            }
            members = await pending;
        }

        if (!members || typeof members[Symbol.iterator] !== 'function'
            || (Number.isInteger(guild.memberCount) && members.size !== guild.memberCount)) {
            throw new Error('サーバーメンバーを取得できません');
        }

        const entries = [...members]
            .filter(([, member]) => member.user?.bot === false)
            .sort(([leftId, left], [rightId, right]) => (
                DISPLAY_NAME_COLLATOR.compare(
                    memberDisplayName(left, leftId),
                    memberDisplayName(right, rightId)
                )
                || String(leftId).localeCompare(String(rightId))
            ));
        return new Collection(entries);
    }
}

export default new GuildMemberService();

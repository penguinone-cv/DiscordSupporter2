import { describe, it, expect, vi, beforeEach } from 'vitest';

// discord.js をモック - SlashCommandBuilder は class として定義する必要がある
vi.mock('discord.js', () => {
    class MockSlashCommandBuilder {
        setName() { return this; }
        setDescription() { return this; }
        addStringOption(fn) {
            fn({
                setName() { return this; },
                setDescription() { return this; },
                setRequired() { return this; },
            });
            return this;
        }
        addIntegerOption(fn) {
            fn({
                setName() { return this; },
                setDescription() { return this; },
                setRequired() { return this; },
                setMinValue() { return this; },
                setMaxValue() { return this; },
            });
            return this;
        }
        addBooleanOption(fn) {
            fn({
                setName() { return this; },
                setDescription() { return this; },
                setRequired() { return this; },
            });
            return this;
        }
        toJSON() { return {}; }
    }

    class MockEmbedBuilder {
        setColor() { return this; }
        setTitle() { return this; }
        setDescription() { return this; }
        setFooter() { return this; }
        setTimestamp() { return this; }
    }

    class MockActionRowBuilder {
        constructor() { this.components = []; }
        addComponents() { return this; }
    }

    class MockButtonBuilder {
        setCustomId() { return this; }
        setLabel() { return this; }
        setStyle() { return this; }
        setDisabled() { return this; }
        static from() { return new MockButtonBuilder(); }
    }

    return {
        SlashCommandBuilder: MockSlashCommandBuilder,
        EmbedBuilder: MockEmbedBuilder,
        ActionRowBuilder: MockActionRowBuilder,
        ButtonBuilder: MockButtonBuilder,
        ButtonStyle: { Primary: 1 },
    };
});

// logger をモック
vi.mock('../../src/utils/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

let voteCommand;

beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/commands/vote.js');
    voteCommand = mod.default;
});

describe('vote command', () => {
    describe('execute()', () => {
        function createMockInteraction(options = {}) {
            const {
                title = 'テスト投票',
                candidate = 'A B C',
                votePeriod = null,
                allowMultiSelect = null,
            } = options;

            return {
                id: 'interaction-1',
                user: { tag: 'TestUser#1234', id: 'user-1' },
                options: {
                    getString: vi.fn().mockImplementation((name) => {
                        if (name === 'title') return title;
                        if (name === 'candidate') return candidate;
                        return null;
                    }),
                    getInteger: vi.fn().mockReturnValue(votePeriod),
                    getBoolean: vi.fn().mockReturnValue(allowMultiSelect),
                },
                reply: vi.fn().mockResolvedValue({ id: 'vote-msg-1' }),
                client: { votes: new Map() },
            };
        }

        it('候補が2つ未満の場合はエラーメッセージを返す', async () => {
            const interaction = createMockInteraction({ candidate: 'only-one' });

            await voteCommand.execute(interaction);

            expect(interaction.reply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('2つ以上'),
                    ephemeral: true,
                })
            );
        });

        it('候補が10個を超える場合はエラーメッセージを返す', async () => {
            const interaction = createMockInteraction({
                candidate: 'A B C D E F G H I J K',
            });

            await voteCommand.execute(interaction);

            expect(interaction.reply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('最大10個'),
                    ephemeral: true,
                })
            );
        });

        it('正常な候補で投票を作成する', async () => {
            const interaction = createMockInteraction({ candidate: 'A B C' });

            await voteCommand.execute(interaction);

            // reply が呼ばれた（Embedとコンポーネント付き）
            expect(interaction.reply).toHaveBeenCalledWith(
                expect.objectContaining({
                    embeds: expect.any(Array),
                    components: expect.any(Array),
                    fetchReply: true,
                })
            );

            // 投票データが保存された
            expect(interaction.client.votes.size).toBe(1);
        });
    });

    describe('handleButton()', () => {
        function createButtonInteraction(voteData, candidateIndex, userId = 'user-1') {
            return {
                customId: `vote_interaction-1_${candidateIndex}`,
                message: { id: 'vote-msg-1' },
                user: { tag: 'TestUser#1234', id: userId },
                client: {
                    votes: new Map([['vote-msg-1', voteData]]),
                },
                reply: vi.fn().mockResolvedValue(undefined),
            };
        }

        it('投票データが存在しない場合はエラーメッセージを返す', async () => {
            const interaction = {
                customId: 'vote_interaction-1_0',
                message: { id: 'nonexistent-msg' },
                user: { tag: 'TestUser#1234', id: 'user-1' },
                client: { votes: new Map() },
                reply: vi.fn().mockResolvedValue(undefined),
            };

            await voteCommand.handleButton(interaction);

            expect(interaction.reply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('終了'),
                    ephemeral: true,
                })
            );
        });

        it('候補に投票する', async () => {
            const voteData = {
                candidates: ['A', 'B', 'C'],
                allowMultiSelect: true,
                votes: new Map(),
            };
            const interaction = createButtonInteraction(voteData, 0);

            await voteCommand.handleButton(interaction);

            expect(interaction.reply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('投票しました'),
                    ephemeral: true,
                })
            );
            expect(voteData.votes.get('user-1').has(0)).toBe(true);
        });

        it('既に投票済みの候補をクリックすると取り消す', async () => {
            const userVotes = new Set([0]);
            const voteData = {
                candidates: ['A', 'B', 'C'],
                allowMultiSelect: true,
                votes: new Map([['user-1', userVotes]]),
            };
            const interaction = createButtonInteraction(voteData, 0);

            await voteCommand.handleButton(interaction);

            expect(interaction.reply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('取り消し'),
                    ephemeral: true,
                })
            );
            expect(voteData.votes.get('user-1').has(0)).toBe(false);
        });

        it('複数選択不可で既に投票済みの場合はエラーを返す', async () => {
            const userVotes = new Set([0]);
            const voteData = {
                candidates: ['A', 'B', 'C'],
                allowMultiSelect: false,
                votes: new Map([['user-1', userVotes]]),
            };
            const interaction = createButtonInteraction(voteData, 1);

            await voteCommand.handleButton(interaction);

            expect(interaction.reply).toHaveBeenCalledWith(
                expect.objectContaining({
                    content: expect.stringContaining('1つの候補にのみ投票'),
                    ephemeral: true,
                })
            );
            expect(voteData.votes.get('user-1').has(0)).toBe(true);
            expect(voteData.votes.get('user-1').has(1)).toBe(false);
        });

        it('複数選択可の場合は複数候補に投票できる', async () => {
            const userVotes = new Set([0]);
            const voteData = {
                candidates: ['A', 'B', 'C'],
                allowMultiSelect: true,
                votes: new Map([['user-1', userVotes]]),
            };
            const interaction = createButtonInteraction(voteData, 1);

            await voteCommand.handleButton(interaction);

            expect(voteData.votes.get('user-1').has(0)).toBe(true);
            expect(voteData.votes.get('user-1').has(1)).toBe(true);
        });
    });

    describe('endVote()', () => {
        it('投票結果を正しく集計する', async () => {
            const mockMessage = {
                components: [],
                edit: vi.fn().mockResolvedValue(undefined),
            };

            const votes = new Map();
            votes.set('user-1', new Set([0, 1]));
            votes.set('user-2', new Set([0]));
            votes.set('user-3', new Set([1, 2]));

            const voteData = {
                title: 'テスト投票',
                messageId: 'vote-msg-1',
                channelId: 'ch-1',
                candidates: ['A', 'B', 'C'],
                votes,
            };

            const client = {
                channels: {
                    cache: {
                        get: vi.fn().mockReturnValue({
                            messages: {
                                fetch: vi.fn().mockResolvedValue(mockMessage),
                            },
                        }),
                    },
                },
                votes: new Map([['vote-msg-1', voteData]]),
            };

            await voteCommand.endVote(client, voteData);

            expect(mockMessage.edit).toHaveBeenCalled();
            expect(client.votes.has('vote-msg-1')).toBe(false);
        });
    });
});

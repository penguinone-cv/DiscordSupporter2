import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import logger from '../utils/logger.js';

/**
 * 投票コマンド
 */
const voteCommand = {
    data: new SlashCommandBuilder()
        .setName('vote')
        .setDescription('投票を作成します')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('投票のタイトル')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('candidate')
                .setDescription('候補（スペース区切りで複数指定）')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('vote_period')
                .setDescription('投票受付期間（時間単位）')
                .setMinValue(1)
                .setMaxValue(168)
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('allow_multi_select')
                .setDescription('複数選択を許可するか')
                .setRequired(false)),

    /**
     * コマンド実行
     */
    async execute(interaction) {
        const title = interaction.options.getString('title');
        const votePeriod = interaction.options.getInteger('vote_period') || 24;
        const allowMultiSelect = interaction.options.getBoolean('allow_multi_select') ?? true;
        const candidateString = interaction.options.getString('candidate');

        // 候補をスペースで分割
        const candidates = candidateString.split(/\s+/).filter(c => c.length > 0);

        if (candidates.length < 2) {
            await interaction.reply({
                content: '❌ 候補は2つ以上指定してください。',
                ephemeral: true
            });
            return;
        }

        if (candidates.length > 10) {
            await interaction.reply({
                content: '❌ 候補は最大10個までです。',
                ephemeral: true
            });
            return;
        }

        // 投票終了時刻を計算
        const endTime = new Date(Date.now() + votePeriod * 60 * 60 * 1000);

        // Embedメッセージを作成
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`📊 ${title}`)
            .setDescription(
                `**投票期間:** ${votePeriod}時間\n` +
                `**終了時刻:** <t:${Math.floor(endTime.getTime() / 1000)}:F>\n` +
                `**複数選択:** ${allowMultiSelect ? '可' : '不可'}\n\n` +
                `**候補一覧:**\n${candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
            )
            .setFooter({ text: `投票作成者: ${interaction.user.tag}` })
            .setTimestamp();

        // ボタンを作成（最大5行、各行最大5ボタン）
        const rows = [];
        for (let i = 0; i < candidates.length; i += 5) {
            const row = new ActionRowBuilder();
            const slice = candidates.slice(i, i + 5);

            slice.forEach((candidate, index) => {
                const buttonIndex = i + index;
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`vote_${interaction.id}_${buttonIndex}`)
                        .setLabel(`${buttonIndex + 1}. ${candidate}`)
                        .setStyle(ButtonStyle.Primary)
                );
            });

            rows.push(row);
        }

        // 投票メッセージを送信
        const voteMessage = await interaction.reply({
            embeds: [embed],
            components: rows,
            fetchReply: true
        });

        logger.info(`投票作成: "${title}" by ${interaction.user.tag}`);

        // 投票データを保存（簡易実装：メモリ内）
        const voteData = {
            messageId: voteMessage.id,
            title,
            candidates,
            allowMultiSelect,
            endTime,
            votes: new Map(), // userId -> Set<candidateIndex>
            creatorId: interaction.user.id
        };

        // グローバルマップに保存（本番環境ではDBに保存すべき）
        if (!interaction.client.votes) {
            interaction.client.votes = new Map();
        }
        interaction.client.votes.set(voteMessage.id, voteData);

        // 投票終了タイマーを設定
        const timeoutMs = votePeriod * 60 * 60 * 1000;
        setTimeout(async () => {
            await this.endVote(interaction.client, voteData);
        }, timeoutMs);
    },

    /**
     * 投票を終了して結果を表示
     */
    async endVote(client, voteData) {
        try {
            const message = await client.channels.cache
                .get(voteData.channelId)
                ?.messages.fetch(voteData.messageId);

            if (!message) return;

            // 結果を集計
            const results = new Array(voteData.candidates.length).fill(0);
            for (const candidateSet of voteData.votes.values()) {
                for (const index of candidateSet) {
                    results[index]++;
                }
            }

            // 結果Embedを作成
            const resultsText = voteData.candidates
                .map((candidate, index) => `${index + 1}. ${candidate}: **${results[index]}票**`)
                .join('\n');

            const totalVoters = voteData.votes.size;

            const resultEmbed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle(`📊 ${voteData.title} - 結果発表`)
                .setDescription(
                    `**投票者数:** ${totalVoters}名\n\n` +
                    `**結果:**\n${resultsText}`
                )
                .setFooter({ text: '投票は終了しました' })
                .setTimestamp();

            // ボタンを無効化して更新
            const disabledRows = message.components.map(row => {
                const newRow = new ActionRowBuilder();
                row.components.forEach(button => {
                    newRow.addComponents(
                        ButtonBuilder.from(button).setDisabled(true)
                    );
                });
                return newRow;
            });

            await message.edit({
                embeds: [resultEmbed],
                components: disabledRows
            });

            logger.info(`投票終了: "${voteData.title}"`);

            // データを削除
            client.votes.delete(voteData.messageId);

        } catch (error) {
            logger.error('投票終了エラー:', error);
        }
    },

    /**
     * ボタンクリック処理
     */
    async handleButton(interaction) {
        const [, voteId, candidateIndexStr] = interaction.customId.split('_');
        const candidateIndex = parseInt(candidateIndexStr);

        const voteData = interaction.client.votes.get(interaction.message.id);

        if (!voteData) {
            await interaction.reply({
                content: '❌ この投票は既に終了しているか、データが見つかりません。',
                ephemeral: true
            });
            return;
        }

        const userId = interaction.user.id;

        // ユーザーの投票を取得または作成
        if (!voteData.votes.has(userId)) {
            voteData.votes.set(userId, new Set());
        }

        const userVotes = voteData.votes.get(userId);

        // 既に投票済みかチェック
        if (userVotes.has(candidateIndex)) {
            // 取り消し
            userVotes.delete(candidateIndex);
            await interaction.reply({
                content: `✅ "${voteData.candidates[candidateIndex]}" への投票を取り消しました。`,
                ephemeral: true
            });
        } else {
            // 複数選択が無効で既に他の候補に投票している場合
            if (!voteData.allowMultiSelect && userVotes.size > 0) {
                await interaction.reply({
                    content: '❌ この投票では1つの候補にのみ投票できます。既存の投票を取り消してから再度投票してください。',
                    ephemeral: true
                });
                return;
            }

            // 投票
            userVotes.add(candidateIndex);
            await interaction.reply({
                content: `✅ "${voteData.candidates[candidateIndex]}" に投票しました！`,
                ephemeral: true
            });
        }

        logger.info(`投票: ${interaction.user.tag} -> ${voteData.candidates[candidateIndex]}`);
    }
};

export default voteCommand;

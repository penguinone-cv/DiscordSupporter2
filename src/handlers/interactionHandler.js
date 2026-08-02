import logger from '../utils/logger.js';

export function interactionErrorContent(error) {
    const retryAfter = Number(
        error?.data?.retry_after
        ?? error?.rawError?.retry_after
    );
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
        return `現在Discordのリクエスト制限中です。${Math.ceil(retryAfter)}秒後にもう一度お試しください。`;
    }
    return 'コマンドの実行中にエラーが発生しました。';
}

/**
 * インタラクション（スラッシュコマンド）ハンドラ
 */
export default async function handleInteraction(interaction) {
    const commandName = interaction.commandName ?? 'component';

    try {
        if (interaction.isButton?.() && interaction.customId.startsWith('vote_')) {
            const { default: voteCommand } = await import('../commands/vote.js');
            await voteCommand.handleButton(interaction);
            return;
        }

        if ((interaction.isButton?.() || interaction.isStringSelectMenu?.())
            && interaction.customId.startsWith('game-user:')) {
            const { default: handleGameMemberInteraction } = await import('../interactions/gameMemberInteractionHandler.js');
            await handleGameMemberInteraction(interaction);
            return;
        }

        if ((interaction.isButton?.() || interaction.isStringSelectMenu?.())
            && interaction.customId.startsWith('schedule-user:')) {
            const { default: handleScheduleMemberInteraction } = await import('../interactions/scheduleMemberInteractionHandler.js');
            await handleScheduleMemberInteraction(interaction);
            return;
        }

        if ((interaction.isButton?.() || interaction.isStringSelectMenu?.())
            && interaction.customId.startsWith('game:')) {
            const { default: handleGameAdminInteraction } = await import('../interactions/gameAdminInteractionHandler.js');
            await handleGameAdminInteraction(interaction);
            return;
        }

        // 上記以外のコンポーネントは無視
        if (!interaction.isChatInputCommand()) return;

        // コマンドに応じて処理を振り分け
        switch (commandName) {
            case 'vote': {
                const { default: voteCommand } = await import('../commands/vote.js');
                await voteCommand.execute(interaction);
                break;
            }
            case 'game-admin': {
                const { default: gameAdminCommand } = await import('../commands/gameAdmin.js');
                await gameAdminCommand.execute(interaction);
                break;
            }
            default:
                await interaction.reply({
                    content: '不明なコマンドです。',
                    ephemeral: true
                });
        }
    } catch (error) {
        logger.error(`コマンド実行エラー (${commandName}):`, error);

        const errorMessage = {
            content: interactionErrorContent(error),
            ephemeral: true
        };

        if (interaction.deferred && !interaction.replied && interaction.editReply) {
            await interaction.editReply({ content: errorMessage.content });
        } else if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    }
}

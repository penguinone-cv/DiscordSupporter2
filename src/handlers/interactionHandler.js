import logger from '../utils/logger.js';

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
            content: 'コマンドの実行中にエラーが発生しました。',
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

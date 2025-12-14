import logger from '../utils/logger.js';

/**
 * インタラクション（スラッシュコマンド）ハンドラ
 */
export default async function handleInteraction(interaction) {
    // スラッシュコマンド以外は無視
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {
        // コマンドに応じて処理を振り分け
        switch (commandName) {
            case 'vote': {
                const { default: voteCommand } = await import('../commands/vote.js');
                await voteCommand.execute(interaction);
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

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    }
}

import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import gameRepository from '../repositories/gameRepository.js';
import activityRepository from '../repositories/activityRepository.js';
import gameRegistryService from '../services/gameRegistryService.js';
import channelActivityService from '../services/channelActivityService.js';
import gameAdminPanelService from '../services/gameAdminPanelService.js';
import gameArchiveService from '../services/gameArchiveService.js';

function assertAdministrator(interaction) {
    if (!interaction.inGuild()) throw new Error('サーバー内でのみ操作できます');
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        throw new Error('サーバー管理権限が必要です');
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
        throw new Error('チャンネル管理権限が必要です');
    }
}

function isEphemeralMessage(interaction) {
    return interaction.message?.flags?.has?.(MessageFlags.Ephemeral) ?? false;
}

async function show(interaction, payload) {
    if (isEphemeralMessage(interaction)) return interaction.update(payload);
    return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

function assertGuildGame(interaction, gameId) {
    const game = gameRepository.findById(Number(gameId));
    if (!game || game.guild_id !== interaction.guildId) throw new Error('対象ゲームが見つかりません');
    return game;
}

export default async function handleGameAdminInteraction(interaction) {
    assertAdministrator(interaction);
    const parts = interaction.customId.split(':');
    const [, action, ...args] = parts;

    if (action === 'list') {
        const [mode, pageString] = args;
        return show(interaction, gameAdminPanelService.buildList(
            interaction.guild,
            mode,
            Number(pageString) || 0
        ));
    }

    if (action === 'select') {
        const [mode, pageString] = args;
        const gameId = interaction.values[0];
        assertGuildGame(interaction, gameId);
        return interaction.update(gameAdminPanelService.buildGameDetail(
            interaction.guild,
            Number(gameId),
            mode,
            Number(pageString) || 0
        ));
    }

    if (action === 'detail') {
        const [mode, pageString, gameId] = args;
        assertGuildGame(interaction, gameId);
        return interaction.update(gameAdminPanelService.buildGameDetail(
            interaction.guild,
            Number(gameId),
            mode,
            Number(pageString) || 0
        ));
    }

    if (action === 'panel' && args[0] === 'reconcile') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const registry = await gameRegistryService.reconcileGuild(interaction.guild);
        const activity = await channelActivityService.reconcileGuild(interaction.guild);
        await gameAdminPanelService.refreshPanel(interaction.guild);
        return interaction.editReply(
            `再同期しました。登録 ${registry.registered}件、活動確認 ${activity.reconciled}件、未確定 ${activity.unknown}件です。`
        );
    }

    if (action === 'archive' || action === 'restore') {
        const [stage, gameId, mode = 'all', pageString = '0'] = args;
        assertGuildGame(interaction, gameId);
        if (stage === 'confirm') {
            return interaction.update(gameAdminPanelService.buildConfirmation(
                interaction.guild,
                Number(gameId),
                action,
                mode,
                Number(pageString) || 0
            ));
        }
        if (stage === 'execute') {
            await interaction.deferUpdate();
            const result = action === 'archive'
                ? await gameArchiveService.archive({
                    guild: interaction.guild,
                    gameId: Number(gameId),
                    userId: interaction.user.id
                })
                : await gameArchiveService.restore({
                    guild: interaction.guild,
                    gameId: Number(gameId),
                    userId: interaction.user.id
                });
            await gameAdminPanelService.refreshPanel(interaction.guild);
            return interaction.editReply({
                content: action === 'archive'
                    ? `✅ ${result.display_name} をソフトアーカイブしました。`
                    : `✅ ${result.display_name} を再稼働しました。`,
                embeds: [],
                components: []
            });
        }
    }

    if (action === 'defer') {
        const [daysString, gameId, mode = 'all', pageString = '0'] = args;
        assertGuildGame(interaction, gameId);
        const days = Number(daysString);
        const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        activityRepository.defer(Number(gameId), until, interaction.user.id, `${days}日保留`);
        await gameAdminPanelService.refreshPanel(interaction.guild);
        return interaction.update(gameAdminPanelService.buildList(
            interaction.guild,
            mode,
            Number(pageString) || 0
        ));
    }

    if (action === 'exclude') {
        const [gameId, mode = 'all', pageString = '0'] = args;
        const game = assertGuildGame(interaction, gameId);
        gameRepository.setArchiveExcluded(game.id, !game.archive_excluded);
        await gameAdminPanelService.refreshPanel(interaction.guild);
        return interaction.update(gameAdminPanelService.buildGameDetail(
            interaction.guild,
            game.id,
            mode,
            Number(pageString) || 0
        ));
    }

    if (action === 'repair') {
        const [operationId] = args;
        await interaction.deferUpdate();
        const game = await gameArchiveService.repairToActive({
            guild: interaction.guild,
            operationId: Number(operationId)
        });
        await gameAdminPanelService.refreshPanel(interaction.guild);
        return interaction.editReply({
            content: `✅ ${game.display_name} を稼働状態へ復旧しました。`,
            embeds: [],
            components: []
        });
    }

    throw new Error('未対応のゲーム管理操作です');
}

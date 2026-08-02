import { MessageFlags } from 'discord.js';
import gameMemberPanelService from '../services/gameMemberPanelService.js';
import gameReturnRequestService from '../services/gameReturnRequestService.js';
import gameAdminPanelService from '../services/gameAdminPanelService.js';

function assertGuildMember(interaction) {
    if (!interaction.inGuild()) throw new Error('サーバー内でのみ操作できます');
    if (!interaction.user || interaction.user.bot) throw new Error('一般メンバーのみ操作できます');
}

function isEphemeralMessage(interaction) {
    return interaction.message?.flags?.has?.(MessageFlags.Ephemeral) ?? false;
}

async function show(interaction, payload) {
    if (isEphemeralMessage(interaction)) return interaction.update(payload);
    return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

export default async function handleGameMemberInteraction(interaction) {
    assertGuildMember(interaction);
    const [, action, ...args] = interaction.customId.split(':');

    if (action === 'home') {
        return show(interaction, gameMemberPanelService.buildMainPanel());
    }

    if (action === 'preferences') {
        const [pageString = '0'] = args;
        return show(interaction, gameMemberPanelService.buildPreferenceEditor(
            interaction.guild,
            interaction.user.id,
            Number(pageString) || 0
        ));
    }

    if (action === 'preferences-save') {
        const [pageString = '0'] = args;
        return interaction.update(gameMemberPanelService.updatePreferencePage(
            interaction.guild,
            interaction.user.id,
            Number(pageString) || 0,
            interaction.values ?? []
        ));
    }

    if (action === 'archived') {
        const [pageString = '0'] = args;
        return show(interaction, gameMemberPanelService.buildArchivedList(
            interaction.guild,
            Number(pageString) || 0
        ));
    }

    if (action === 'select') {
        const [pageString = '0'] = args;
        const gameId = Number(interaction.values[0]);
        return interaction.update(gameMemberPanelService.buildGameDetail(
            interaction.guild,
            interaction.user.id,
            gameId,
            Number(pageString) || 0
        ));
    }

    if (action === 'detail') {
        const [gameId, pageString = '0'] = args;
        return show(interaction, gameMemberPanelService.buildGameDetail(
            interaction.guild,
            interaction.user.id,
            Number(gameId),
            Number(pageString) || 0
        ));
    }

    if (action === 'restore-toggle') {
        const [gameId, pageString = '0'] = args;
        await interaction.deferUpdate();
        await gameReturnRequestService.toggle({
            guild: interaction.guild,
            gameId: Number(gameId),
            userId: interaction.user.id
        });
        await gameAdminPanelService.refreshPanel(interaction.guild);
        return interaction.editReply(gameMemberPanelService.buildGameDetail(
            interaction.guild,
            interaction.user.id,
            Number(gameId),
            Number(pageString) || 0
        ));
    }

    throw new Error('未対応の一般ユーザー向けゲーム操作です');
}

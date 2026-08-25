import { MessageFlags } from 'discord.js';
import gameMemberPanelService from '../services/gameMemberPanelService.js';
import gameRecruitmentService from '../services/gameRecruitmentService.js';
import scheduleService from '../services/scheduleService.js';
import schedulePanelService from '../services/schedulePanelService.js';

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

export default async function handleScheduleMemberInteraction(interaction) {
    assertGuildMember(interaction);
    const [, action, ...args] = interaction.customId.split(':');
    const userId = interaction.user.id;

    if (action === 'home') {
        return show(interaction, gameMemberPanelService.buildMainPanel());
    }

    if (action === 'basic') {
        const [pageString = '0'] = args;
        return show(interaction, schedulePanelService.buildBasicEditor(
            interaction.guild,
            userId,
            Number(pageString) || 0
        ));
    }

    if (action === 'basic-cycle') {
        const [pageString = '0', templateIdString] = args;
        scheduleService.cycleBasicStatus({
            guildId: interaction.guildId,
            userId,
            requestedPage: Number(pageString) || 0,
            templateId: Number(templateIdString)
        });
        return interaction.update(schedulePanelService.buildBasicEditor(
            interaction.guild,
            userId,
            Number(pageString) || 0
        ));
    }

    if (action === 'month-open') {
        const [offsetString = '0', weekString = '0'] = args;
        return show(interaction, schedulePanelService.buildMonthByOffset(
            interaction.guild,
            userId,
            Number(offsetString) || 0,
            Number(weekString) || 0
        ));
    }

    if (action === 'month-week') {
        const [monthIdString, weekString = '0'] = args;
        return show(interaction, schedulePanelService.buildMonthWeek(
            interaction.guild,
            userId,
            Number(monthIdString),
            Number(weekString) || 0
        ));
    }

    if (action === 'month-day-select') {
        const [monthIdString, weekString = '0'] = args;
        return interaction.update(schedulePanelService.buildMonthDay(
            interaction.guild,
            userId,
            Number(monthIdString),
            Number(weekString) || 0,
            interaction.values[0]
        ));
    }

    if (action === 'month-cycle') {
        const [monthIdString, weekString = '0', localDate, slotIdString] = args;
        scheduleService.cycleMonthStatus({
            guildId: interaction.guildId,
            userId,
            monthId: Number(monthIdString),
            requestedWeek: Number(weekString) || 0,
            localDate,
            slotId: Number(slotIdString)
        });
        return interaction.update(schedulePanelService.buildMonthDay(
            interaction.guild,
            userId,
            Number(monthIdString),
            Number(weekString) || 0,
            localDate
        ));
    }

    if (action === 'month-reset-confirm') {
        const [monthIdString, weekString = '0'] = args;
        return show(interaction, schedulePanelService.buildResetConfirmation(
            interaction.guild,
            userId,
            Number(monthIdString),
            Number(weekString) || 0
        ));
    }

    if (action === 'month-reset-execute') {
        const [monthIdString, weekString = '0'] = args;
        scheduleService.resetWeekToBasic({
            guildId: interaction.guildId,
            userId,
            monthId: Number(monthIdString),
            requestedWeek: Number(weekString) || 0
        });
        return interaction.update(schedulePanelService.buildMonthWeek(
            interaction.guild,
            userId,
            Number(monthIdString),
            Number(weekString) || 0
        ));
    }

    if (action === 'candidate-open') {
        const [offsetString = '0', pageString = '0'] = args;
        return show(interaction, schedulePanelService.buildCandidateByOffset(
            interaction.guild,
            Number(offsetString) || 0,
            Number(pageString) || 0
        ));
    }

    if (action === 'candidate-games') {
        const [monthIdString, pageString = '0'] = args;
        return show(interaction, schedulePanelService.buildCandidateGameList(
            interaction.guild,
            Number(monthIdString),
            Number(pageString) || 0
        ));
    }

    if (action === 'candidate-select') {
        const [monthIdString, pageString = '0'] = args;
        await interaction.deferUpdate();
        const payload = await schedulePanelService.buildCandidateResults(
            interaction.guild,
            Number(monthIdString),
            Number(interaction.values[0]),
            Number(pageString) || 0
        );
        return interaction.editReply({ ...payload, content: null });
    }

    if (action === 'candidate-slot-select') {
        const [monthIdString, gameIdString, pageString = '0'] = args;
        await interaction.deferUpdate();
        const payload = await schedulePanelService.buildCandidateResults(
            interaction.guild,
            Number(monthIdString),
            Number(gameIdString),
            Number(pageString) || 0,
            Number(interaction.values[0])
        );
        return interaction.editReply({ ...payload, content: null });
    }

    if (action === 'candidate-recruit') {
        const [monthIdString, gameIdString, pageString = '0', slotIdString] = args;
        const monthId = Number(monthIdString);
        const gameId = Number(gameIdString);
        const gamePage = Number(pageString) || 0;
        const slotId = Number(slotIdString);
        if (!Number.isSafeInteger(slotId) || slotId <= 0) {
            throw new Error('募集する候補日程を選択してください');
        }

        await interaction.deferUpdate();
        try {
            await gameRecruitmentService.createRecruitment({
                guild: interaction.guild,
                monthId,
                gameId,
                slotId,
                userId
            });
        } catch (error) {
            if (error?.name === 'GameRecruitmentError') {
                return interaction.editReply({ content: `❌ ${error.message}` });
            }
            throw error;
        }
        const payload = await schedulePanelService.buildCandidateResults(
            interaction.guild,
            monthId,
            gameId,
            gamePage,
            slotId
        );
        return interaction.editReply({
            ...payload,
            content: '✅ ゲームチャンネルへ募集メッセージを送信しました。'
        });
    }

    throw new Error('未対応の予定表操作です');
}

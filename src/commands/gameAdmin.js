import {
    ChannelType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder
} from 'discord.js';
import guildSettingsRepository from '../repositories/guildSettingsRepository.js';
import gameRegistryService from '../services/gameRegistryService.js';
import channelActivityService from '../services/channelActivityService.js';
import gameAdminPanelService from '../services/gameAdminPanelService.js';
import gameMemberPanelService from '../services/gameMemberPanelService.js';
import gameReturnRequestService from '../services/gameReturnRequestService.js';

function assertAdministrator(interaction) {
    if (!interaction.inGuild()) throw new Error('サーバー内でのみ使用できます');
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        throw new Error('サーバー管理権限が必要です');
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
        throw new Error('チャンネル管理権限が必要です');
    }
}

const gameAdminCommand = {
    data: new SlashCommandBuilder()
        .setName('game-admin')
        .setDescription('ゲームチャンネル管理を設定します')
        .setDefaultMemberPermissions(
            PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageChannels
        )
        .addSubcommand(subcommand => subcommand
            .setName('setup')
            .setDescription('ゲームカテゴリと管理パネルを設定します')
            .addChannelOption(option => option
                .setName('game_category')
                .setDescription('稼働中ゲームのカテゴリ')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true))
            .addChannelOption(option => option
                .setName('admin_channel')
                .setDescription('管理パネルを設置するチャンネル')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
            .addIntegerOption(option => option
                .setName('dormant_days')
                .setDescription('休眠候補とする未活動日数')
                .setMinValue(7)
                .setMaxValue(365)
                .setRequired(false))
            .addStringOption(option => option
                .setName('archive_visibility')
                .setDescription('休止中チャンネルの表示方法')
                .addChoices(
                    { name: '閲覧のみ可能', value: 'read_only' },
                    { name: '一般メンバーから非表示', value: 'hidden' }
                )
                .setRequired(false)))
        .addSubcommand(subcommand => subcommand
            .setName('panel')
            .setDescription('管理パネルを再設置または更新します'))
        .addSubcommand(subcommand => subcommand
            .setName('member-panel')
            .setDescription('一般ユーザー用のゲームパネルを設置します')
            .addChannelOption(option => option
                .setName('channel')
                .setDescription('一般ユーザー用パネルを設置するチャンネル')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
            .addIntegerOption(option => option
                .setName('restore_threshold')
                .setDescription('管理者へ通知する復帰希望人数')
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(false)))
        .addSubcommand(subcommand => subcommand
            .setName('reconcile')
            .setDescription('ゲームチャンネルと活動状況を再同期します'))
        .addSubcommand(subcommand => subcommand
            .setName('repair')
            .setDescription('中断したアーカイブ操作を確認します')),

    async execute(interaction) {
        assertAdministrator(interaction);
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'setup') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const gameCategory = interaction.options.getChannel('game_category', true);
            const adminChannel = interaction.options.getChannel('admin_channel', true);
            const dormantAfterDays = interaction.options.getInteger('dormant_days') ?? 90;
            const archiveVisibility = interaction.options.getString('archive_visibility') ?? 'read_only';
            if (!adminChannel.isSendable()) throw new Error('管理チャンネルへBotが投稿できません');
            guildSettingsRepository.upsert({
                guildId: interaction.guildId,
                gameCategoryId: gameCategory.id,
                adminChannelId: adminChannel.id,
                dormantAfterDays,
                archiveVisibility
            });
            const registry = await gameRegistryService.reconcileGuild(interaction.guild);
            const activity = await channelActivityService.reconcileGuild(interaction.guild);
            await gameAdminPanelService.ensurePanel(interaction.guild);
            await interaction.editReply(
                `設定しました。ゲーム登録 ${registry.registered}件、活動確認 ${activity.reconciled}件です。`
            );
            return;
        }

        if (subcommand === 'panel') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const message = await gameAdminPanelService.ensurePanel(interaction.guild);
            if (!message) throw new Error('先に /game-admin setup を実行してください');
            await interaction.editReply(`管理パネルを更新しました: ${message.url}`);
            return;
        }

        if (subcommand === 'member-panel') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const settings = guildSettingsRepository.find(interaction.guildId);
            if (!settings?.game_category_id) throw new Error('先に /game-admin setup を実行してください');
            const channel = interaction.options.getChannel('channel', true);
            const restoreRequestThreshold = interaction.options.getInteger('restore_threshold')
                ?? settings.restore_request_threshold
                ?? 5;
            if (!channel.isSendable()) throw new Error('指定したチャンネルへBotが投稿できません');
            guildSettingsRepository.setMemberPanelSettings(interaction.guildId, {
                channelId: channel.id,
                restoreRequestThreshold
            });
            const message = await gameMemberPanelService.ensurePanel(interaction.guild);
            await gameReturnRequestService.reconcileGuild(interaction.guild);
            await interaction.editReply(
                `一般ユーザー用パネルを設定しました。復帰希望 ${restoreRequestThreshold}人で管理者へ通知します: ${message.url}`
            );
            return;
        }

        if (subcommand === 'reconcile') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const registry = await gameRegistryService.reconcileGuild(interaction.guild);
            const activity = await channelActivityService.reconcileGuild(interaction.guild);
            await gameAdminPanelService.refreshPanel(interaction.guild);
            await interaction.editReply(
                `再同期しました。登録 ${registry.registered}件、紐付け切れ ${registry.detached}件、活動確認 ${activity.reconciled}件、未確定 ${activity.unknown}件です。`
            );
            return;
        }

        await interaction.reply({
            ...gameAdminPanelService.buildRepairList(interaction.guild),
            flags: MessageFlags.Ephemeral
        });
    }
};

export { assertAdministrator };
export default gameAdminCommand;

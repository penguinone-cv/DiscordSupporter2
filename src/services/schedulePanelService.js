import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    StringSelectMenuBuilder
} from 'discord.js';
import scheduleService from './scheduleService.js';
import gameCandidateService from './gameCandidateService.js';
import {
    DAY_RULE_LABELS,
    currentDateKey,
    formatDateLabel
} from '../utils/scheduleDate.js';

const GAME_PAGE_SIZE = 25;
const CANDIDATE_PAGE_SIZE = 10;

const STATUS_META = {
    available: { symbol: '○', label: '参加可能', style: ButtonStyle.Success },
    maybe: { symbol: '△', label: '未定', style: ButtonStyle.Primary },
    unavailable: { symbol: '×', label: '参加不可', style: ButtonStyle.Danger },
    unset: { symbol: '―', label: '未入力', style: ButtonStyle.Secondary }
};

function statusMeta(status) {
    return STATUS_META[status ?? 'unset'];
}

function monthTitle(month) {
    return `${month.year}年${month.month}月`;
}

export function isFutureCandidate(candidate, timezone, now = new Date()) {
    return candidate.localDate >= currentDateKey(now, timezone);
}

function buttonRows(buttons) {
    const rows = [];
    for (let index = 0; index < buttons.length; index += 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5)));
    }
    return rows;
}

class SchedulePanelService {
    buildBasicEditor(guild, userId, requestedPage = 0) {
        const day = scheduleService.getBasicDay(guild.id, userId, requestedPage);
        const lines = day.templates.map(template => {
            const meta = statusMeta(template.status);
            return `${template.label}：**${meta.symbol} ${meta.label}**`;
        });
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`📌 基本予定 ${day.page + 1}/${day.pages}：${DAY_RULE_LABELS[day.dayRule]}`)
            .setDescription([
                ...(lines.length ? lines : ['この曜日区分には時間枠がありません。']),
                '',
                'ボタンを押すたびに「未入力 → ○ → △ → ×」の順で切り替わります。',
                '変更は今後作成・初期化する月間予定へ反映されます。'
            ].join('\n'));

        const statusButtons = day.templates.map(template => {
            const meta = statusMeta(template.status);
            return new ButtonBuilder()
                .setCustomId(`schedule-user:basic-cycle:${day.page}:${template.id}`)
                .setLabel(`${template.label}：${meta.symbol}`)
                .setStyle(meta.style);
        });
        const components = buttonRows(statusButtons);
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`schedule-user:basic:${day.page - 1}`)
                .setLabel('前へ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(day.page === 0),
            new ButtonBuilder()
                .setCustomId(`schedule-user:basic:${day.page + 1}`)
                .setLabel('次へ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(day.page >= day.pages - 1),
            new ButtonBuilder()
                .setCustomId('schedule-user:home')
                .setLabel('案内へ戻る')
                .setStyle(ButtonStyle.Secondary)
        ));
        return { embeds: [embed], components };
    }

    buildMonthByOffset(guild, userId, offset = 0, week = 0) {
        const month = scheduleService.getMonthByOffset(guild.id, offset);
        return this.buildMonthWeek(guild, userId, month.id, week);
    }

    buildMonthWeek(guild, userId, monthId, requestedWeek = 0) {
        const view = scheduleService.getUserMonth(guild.id, userId, monthId, requestedWeek);
        const lines = view.dates.map(date => {
            const slots = view.slotsByDate.get(date) ?? [];
            const statuses = slots.map(slot => `${slot.label} ${statusMeta(slot.status).symbol}`).join('　');
            return `**${formatDateLabel(date)}**　${statuses || '時間枠なし'}`;
        });
        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle(`📅 ${monthTitle(view.month)}の予定 ${view.week + 1}/${view.weeks}`)
            .setDescription([
                ...lines,
                '',
                '日付を選ぶと予定を変更できます。変更内容は即時保存されます。'
            ].join('\n'));

        const dateSelect = new StringSelectMenuBuilder()
            .setCustomId(`schedule-user:month-day-select:${view.month.id}:${view.week}`)
            .setPlaceholder('変更する日付を選択')
            .addOptions(view.dates.map(date => ({
                label: formatDateLabel(date),
                value: date,
                description: (view.slotsByDate.get(date) ?? [])
                    .map(slot => `${slot.label}${statusMeta(slot.status).symbol}`)
                    .join(' / ')
                    .slice(0, 100)
            })));
        const components = [new ActionRowBuilder().addComponents(dateSelect)];
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`schedule-user:month-week:${view.month.id}:${view.week - 1}`)
                .setLabel('前の週')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(view.week === 0),
            new ButtonBuilder()
                .setCustomId(`schedule-user:month-reset-confirm:${view.month.id}:${view.week}`)
                .setLabel('基本予定に戻す')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`schedule-user:month-week:${view.month.id}:${view.week + 1}`)
                .setLabel('次の週')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(view.week >= view.weeks - 1)
        ));
        components.push(this.buildMonthNavigation(view.month));
        return { embeds: [embed], components };
    }

    buildMonthDay(guild, userId, monthId, requestedWeek, localDate) {
        const view = scheduleService.getUserDay(
            guild.id,
            userId,
            monthId,
            requestedWeek,
            localDate
        );
        const lines = view.slots.map(slot => {
            const meta = statusMeta(slot.status);
            const source = slot.source === 'basic'
                ? '基本予定'
                : (slot.source === 'manual' ? '月間設定' : '未入力');
            return `${slot.label}：**${meta.symbol} ${meta.label}**（${source}）`;
        });
        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle(`📅 ${formatDateLabel(localDate, { includeYear: true })}`)
            .setDescription([
                ...(lines.length ? lines : ['この日の時間枠はありません。']),
                '',
                'ボタンを押すたびに「未入力 → ○ → △ → ×」の順で切り替わります。'
            ].join('\n'));
        const buttons = view.slots.map(slot => {
            const meta = statusMeta(slot.status);
            return new ButtonBuilder()
                .setCustomId(
                    `schedule-user:month-cycle:${view.month.id}:${view.week}:${localDate}:${slot.id}`
                )
                .setLabel(`${slot.label}：${meta.symbol}`)
                .setStyle(meta.style);
        });
        const components = buttonRows(buttons);
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`schedule-user:month-week:${view.month.id}:${view.week}`)
                .setLabel('週表示へ戻る')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('schedule-user:home')
                .setLabel('案内へ戻る')
                .setStyle(ButtonStyle.Secondary)
        ));
        return { embeds: [embed], components };
    }

    buildResetConfirmation(guild, userId, monthId, requestedWeek) {
        const view = scheduleService.getUserMonth(guild.id, userId, monthId, requestedWeek);
        const embed = new EmbedBuilder()
            .setColor(0xFEE75C)
            .setTitle('この週を基本予定に戻しますか？')
            .setDescription([
                `${formatDateLabel(view.dates[0])}〜${formatDateLabel(view.dates.at(-1))}`,
                'この週に入力した月間設定は、現在の基本予定で置き換えられます。'
            ].join('\n'));
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`schedule-user:month-reset-execute:${view.month.id}:${view.week}`)
                .setLabel('基本予定に戻す')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`schedule-user:month-week:${view.month.id}:${view.week}`)
                .setLabel('キャンセル')
                .setStyle(ButtonStyle.Secondary)
        );
        return { embeds: [embed], components: [row] };
    }

    buildCandidateByOffset(guild, offset = 0, page = 0) {
        const month = scheduleService.getMonthByOffset(guild.id, offset);
        return this.buildCandidateGameList(guild, month.id, page);
    }

    buildCandidateGameList(guild, monthId, requestedPage = 0) {
        const month = scheduleService.getMonth(guild.id, monthId);
        const games = gameCandidateService.listGames(guild.id);
        const pages = Math.max(1, Math.ceil(games.length / GAME_PAGE_SIZE));
        const page = Math.max(0, Math.min(requestedPage, pages - 1));
        const pageGames = games.slice(page * GAME_PAGE_SIZE, (page + 1) * GAME_PAGE_SIZE);
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`🔎 ${monthTitle(month)}の候補日程`)
            .setDescription(pageGames.length
                ? '候補日程を集計するゲームを選択してください。'
                : '現在、候補日程を集計できる稼働中ゲームはありません。');
        const components = [];
        if (pageGames.length) {
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`schedule-user:candidate-select:${month.id}:${page}`)
                    .setPlaceholder('ゲームを選択')
                    .addOptions(pageGames.map(game => ({
                        label: game.display_name.slice(0, 100),
                        value: String(game.id)
                    })))
            ));
        }
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`schedule-user:candidate-games:${month.id}:${page - 1}`)
                .setLabel('前へ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`schedule-user:candidate-games:${month.id}:${page + 1}`)
                .setLabel('次へ')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= pages - 1)
        ));
        components.push(this.buildCandidateMonthNavigation(month));
        return { embeds: [embed], components };
    }

    async buildCandidateResults(
        guild,
        monthId,
        gameId,
        gamePage = 0,
        selectedSlotId = null
    ) {
        const result = await gameCandidateService.aggregate(guild, monthId, gameId);
        const topCandidates = result.candidates
            .filter(candidate => isFutureCandidate(candidate, result.month.timezone))
            .slice(0, CANDIDATE_PAGE_SIZE);
        const selectedCandidate = topCandidates.find(
            candidate => candidate.slotId === Number(selectedSlotId)
        );
        const lines = topCandidates.map((candidate, index) => [
            `**${index + 1}. ${formatDateLabel(candidate.localDate)} ${candidate.label}**`,
            `○ ${candidate.availableCount}人 / △ ${candidate.maybeCount}人 / × ${candidate.unavailableCount}人`
        ].join('\n'));
        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle(`🎮 ${result.game.display_name}の候補日程`)
            .setDescription(lines.length
                ? [
                    `対象：${monthTitle(result.month)}`,
                    '募集する候補日程を選択してください。',
                    ...lines
                ].join('\n\n')
                : `対象：${monthTitle(result.month)}\n\n当日以降の○または△の候補日程はありません。`);
        const components = [];
        if (topCandidates.length) {
            components.push(new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(
                        `schedule-user:candidate-slot-select:${result.month.id}:${result.game.id}:${gamePage}`
                    )
                    .setPlaceholder('募集する候補日程を選択')
                    .addOptions(topCandidates.map((candidate, index) => ({
                        label: `${index + 1}. ${formatDateLabel(candidate.localDate)} ${candidate.label}`
                            .slice(0, 100),
                        value: String(candidate.slotId),
                        description: `○ ${candidate.availableCount}人 / △ ${candidate.maybeCount}人 / × ${candidate.unavailableCount}人`,
                        default: candidate.slotId === selectedCandidate?.slotId
                    })))
            ));
        }
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(
                    `schedule-user:candidate-recruit:${result.month.id}:${result.game.id}:${gamePage}:${selectedCandidate?.slotId ?? 'none'}`
                )
                .setLabel('この日程で募集する')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!selectedCandidate),
            new ButtonBuilder()
                .setCustomId(`schedule-user:candidate-games:${result.month.id}:${gamePage}`)
                .setLabel('別のゲームを選ぶ')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('schedule-user:home')
                .setLabel('案内へ戻る')
                .setStyle(ButtonStyle.Secondary)
        ));
        return { embeds: [embed], components };
    }

    buildMonthNavigation(displayedMonth) {
        const current = scheduleService.getMonthByOffset(displayedMonth.guild_id, 0);
        const next = scheduleService.getMonthByOffset(displayedMonth.guild_id, 1);
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('schedule-user:month-open:0:0')
                .setLabel('今月')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(displayedMonth.id === current.id),
            new ButtonBuilder()
                .setCustomId('schedule-user:month-open:1:0')
                .setLabel('翌月')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(displayedMonth.id === next.id),
            new ButtonBuilder()
                .setCustomId('schedule-user:home')
                .setLabel('案内へ戻る')
                .setStyle(ButtonStyle.Secondary)
        );
    }

    buildCandidateMonthNavigation(displayedMonth) {
        const current = scheduleService.getMonthByOffset(displayedMonth.guild_id, 0);
        const next = scheduleService.getMonthByOffset(displayedMonth.guild_id, 1);
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('schedule-user:candidate-open:0:0')
                .setLabel('今月')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(displayedMonth.id === current.id),
            new ButtonBuilder()
                .setCustomId('schedule-user:candidate-open:1:0')
                .setLabel('翌月')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(displayedMonth.id === next.id),
            new ButtonBuilder()
                .setCustomId('schedule-user:home')
                .setLabel('案内へ戻る')
                .setStyle(ButtonStyle.Secondary)
        );
    }
}

export { STATUS_META, statusMeta };
export default new SchedulePanelService();

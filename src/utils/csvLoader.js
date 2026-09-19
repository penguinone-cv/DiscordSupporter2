import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

export const EXAMPLE_LIMITS = Object.freeze({ count: 32, message: 2000, reason: 500, total: 16000 });
export class ExampleValidationError extends Error {}

export function validateExamples(records) {
    if (!Array.isArray(records) || records.length > EXAMPLE_LIMITS.count) {
        throw new ExampleValidationError(`判定例は配列で最大${EXAMPLE_LIMITS.count}件です`);
    }
    const seen = new Map();
    let total = 0;
    return records.map((record, index) => {
        const fail = message => { throw new ExampleValidationError(`${index + 1}行目: ${message}`); };
        if (!record || typeof record.message !== 'string' || !record.message.trim()) fail('本文が空です');
        if (!['true', 'false'].includes(record.is_recruitment)) fail('募集ラベルはtrue/falseです');
        if (record.reason !== undefined && typeof record.reason !== 'string') fail('理由は文字列です');
        const message = record.message.trim();
        const reason = (record.reason ?? '').trim();
        if (message.length > EXAMPLE_LIMITS.message || reason.length > EXAMPLE_LIMITS.reason) fail('本文または理由が長すぎます');
        const key = message.normalize('NFKC').replace(/\s+/gu, ' ').toLowerCase();
        if (seen.has(key)) fail(seen.get(key) === record.is_recruitment ? '本文が重複しています' : '同じ本文のラベルが矛盾しています');
        seen.set(key, record.is_recruitment);
        total += message.length + reason.length;
        if (total > EXAMPLE_LIMITS.total) fail(`判定例の合計は${EXAMPLE_LIMITS.total}文字以下です`);
        return { message, is_recruitment: record.is_recruitment, reason };
    });
}

export default {
    load(filePath) {
        // Propagate failures: callers must retain the last valid snapshot.
        let hasHeader = false;
        const records = parse(readFileSync(filePath, 'utf-8'), {
            columns(header) {
                if (!header.includes('message') || !header.includes('is_recruitment')
                    || new Set(header).size !== header.length
                    || header.some(key => !['message', 'is_recruitment', 'reason'].includes(key))) {
                    throw new ExampleValidationError('CSVヘッダーはmessage,is_recruitment,reasonです（reasonは省略可）');
                }
                hasHeader = true;
                return header;
            },
            skip_empty_lines: true, trim: true, bom: true
        });
        if (!hasHeader) throw new ExampleValidationError('CSVヘッダーがありません');
        return validateExamples(records);
    }
};

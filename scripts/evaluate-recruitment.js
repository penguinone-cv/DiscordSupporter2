import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import config from '../src/config/configLoader.js';
import { getJevSettings } from '../src/config/recruitmentConfig.js';
import csvLoader from '../src/utils/csvLoader.js';
import openaiService from '../src/services/openaiService.js';
import { classifyRecruitment } from '../src/services/recruitmentClassifier.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const live = args.includes('--live');
const split = args.includes('--test') ? 'test' : 'dev';
const configIndex = args.indexOf('--config');
if (configIndex >= 0 && (!args[configIndex + 1] || args[configIndex + 1].startsWith('--'))) throw new Error('--config requires a file path');
const configuration = configIndex >= 0 ? resolve(args[configIndex + 1]) : resolve(root, 'config.json');
if (configIndex >= 0 && !existsSync(configuration)) throw new Error('Specified config file does not exist');
config.config = existsSync(configuration) ? JSON.parse(readFileSync(configuration, 'utf8')) : {};
config.config.openai = { ...config.config.openai, apiKey: process.env.OPENAI_API_KEY || config.config.openai?.apiKey };
config.config.jev = { ...config.config.jev, apiKey: process.env.TYPESAFE_API_KEY || config.config.jev?.apiKey };
const thresholdIndex = args.indexOf('--threshold');
if (thresholdIndex >= 0) {
    const threshold = Number(args[thresholdIndex + 1]);
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) throw new Error('--threshold must be greater than 0 and at most 1');
    config.config.jev.threshold = threshold;
}
const examples = csvLoader.load(resolve(root, config.get('features.recruitmentDetection.csvPath') ?? 'recruitment_data.csv'));
const cases = JSON.parse(readFileSync(resolve(root, 'evals/recruitment/cases.json'), 'utf8'));
const normalize = text => text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
const seen = new Set(examples.map(row => normalize(row.message)));
const ids = new Set();
for (const row of cases) {
    if (!row.id || ids.has(row.id) || !['dev', 'test'].includes(row.split) || typeof row.isRecruitment !== 'boolean' || typeof row.message !== 'string' || !row.message.trim()) throw new Error('Invalid evaluation case');
    if (seen.has(normalize(row.message))) throw new Error(`Duplicate / example leakage: ${row.id}`);
    seen.add(normalize(row.message)); ids.add(row.id);
}
const selected = cases.filter(row => row.split === split);
console.log(JSON.stringify({ mode: live ? 'live' : 'dry-run', split, examples: examples.length, cases: selected.length,
    exampleHash: createHash('sha256').update(JSON.stringify(examples)).digest('hex'),
    caseHash: createHash('sha256').update(JSON.stringify(selected)).digest('hex') }));
if (!live) {
    console.log('Dataset validation passed; no API calls. Use --live for dev, --live --test for held-out evaluation.');
} else {
    for (const provider of ['openai', 'jev']) {
        const key = config.get(`${provider}.apiKey`);
        if (!key || key.includes('YOUR_')) throw new Error(`Missing ${provider} API key`);
    }
    getJevSettings(config);
    openaiService.initialize();
    for (const provider of ['openai', 'jev']) {
        const counts = { tp: 0, fp: 0, tn: 0, fn: 0, errors: 0 };
        const latencies = [];
        for (const row of selected) {
            const start = performance.now();
            try {
                const result = await classifyRecruitment(provider, row.message, examples);
                counts[row.isRecruitment ? (result.isRecruitment ? 'tp' : 'fn') : (result.isRecruitment ? 'fp' : 'tn')]++;
                latencies.push(performance.now() - start);
                console.log(JSON.stringify({ provider, id: row.id, expected: row.isRecruitment, actual: result.isRecruitment, probability: result.probability, model: result.model }));
            } catch {
                counts.errors++;
                console.log(JSON.stringify({ provider, id: row.id, error: true }));
            }
        }
        const ratio = (a, b) => b ? a / b : null;
        console.log(JSON.stringify({ provider, split, model: config.get(`${provider}.model`) ?? (provider === 'jev' ? 'jev-latest' : openaiService.model), threshold: provider === 'jev' ? getJevSettings(config).threshold : undefined,
            ...counts, precision: ratio(counts.tp, counts.tp + counts.fp), recall: ratio(counts.tp, counts.tp + counts.fn),
            meanMs: ratio(latencies.reduce((a, b) => a + b, 0), latencies.length) }));
        if (counts.errors) process.exitCode = 1;
    }
}

import { copyFileSync, constants, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config/configLoader.js';
import csvLoader from '../utils/csvLoader.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function examplePath() {
    const path = config.get('features.recruitmentDetection.csvPath');
    if (typeof path !== 'string' || !path.trim()) throw new Error('判定例のCSVパスが未設定です');
    const configured = resolve(root, path);
    // Compose keeps the legacy single-file mount as a read-only migration source.
    // Only redirect that exact legacy path; custom config paths remain authoritative.
    const directory = process.env.RECRUITMENT_EXAMPLES_DIRECTORY;
    if (!directory || configured !== resolve(root, 'recruitment_data.csv')) return configured;
    const destination = resolve(directory, 'recruitment_data.csv');
    if (!existsSync(destination)) {
        csvLoader.load(configured); // Never seed an invalid dataset.
        try {
            copyFileSync(configured, destination, constants.COPYFILE_EXCL);
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }
    }
    return destination;
}

import fs from 'fs/promises';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dataDir = path.resolve(__dirname, '../../data');
const latestPath = path.join(dataDir, 'latest.json');

export const getLatestBundle = async () => {
  try {
    const data = await fs.readFile(latestPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
};

export const getLatestBundleStats = async () => {
  try {
    const stats = await fs.stat(latestPath);
    return stats;
  } catch (error) {
    return null;
  }
};

export const getSourceData = async (key: string) => {
  try {
    const sourcePath = path.join(dataDir, 'by-source', `${key}.json`);
    const data = await fs.readFile(sourcePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
};

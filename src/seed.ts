import { AppData, DEFAULT_SETTINGS } from "./types";

/** 初回起動時に投入する初期データ(カテゴリ・案件なしの空の状態) */
export function buildSeedData(): AppData {
  return { sections: [], projects: [], settings: structuredClone(DEFAULT_SETTINGS) };
}

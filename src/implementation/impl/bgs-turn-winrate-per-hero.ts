/* eslint-disable @typescript-eslint/no-use-before-define */
import { NumericTurnInfo } from '@firestone-hs/hs-replay-xml-parser/dist/lib/model/numeric-turn-info';
import { BgsPostMatchStats, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { inflate } from 'pako';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { getConnection as getConnectionBgs } from '../../mr-lambda-common/services/rds-bgs';
import { Implementation } from '../implementation';
import { TotalDataTurnInfo } from '../total-data-turn-info';
import { loadBgReviewIds, loadMergedOutput } from './battlegrounds-implementation-common';

export class BgsTurnWinratePerHero implements Implementation {
	private readonly JOB_NAME = 'bgs-combat-winrate';

	public async loadReviewIds(query: string): Promise<readonly string[]> {
		return loadBgReviewIds(query, this.JOB_NAME, 50000);
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview, replayXml: string): Promise<IntermediaryResult> {
		if (!replay) {
			console.warn('empty replay');
			return null;
		}

		const mysql = await getConnectionBgs();
		const loadQuery = `
			SELECT * FROM bgs_single_run_stats
			WHERE reviewId = '${miniReview.id}'
		`;
		console.log('running query', loadQuery);
		const rawResults = await mysql.query(loadQuery);
		const postMatchStats: any[] = (rawResults as any[]).filter(
			result => result.jsonStats && result.jsonStats.length <= 50000,
		);
		if (!postMatchStats || postMatchStats.length === 0) {
			console.log('no postmatchstats, returning', loadQuery, rawResults);
			return null;
		}
		if (postMatchStats.length > 1) {
			console.error('Too many postmatch stats for review', miniReview.id);
			return null;
		}

		const inflatedStats = postMatchStats
			.map(result => {
				const stats = parseStats(result.jsonStats);
				return {
					reviewId: result.reviewId,
					stats: stats,
				};
			})
			.filter(result => result.stats);
		if (!inflatedStats || inflatedStats.length === 0) {
			console.log('no inflatedStats, returning', loadQuery, rawResults);
			return null;
		}

		const battleResultHistory = inflatedStats[0].stats.battleResultHistory;
		if (!battleResultHistory || battleResultHistory.length === 0) {
			console.log('no battleResultHistory, returning', loadQuery);
			return null;
		}

		// console.log('inflated stats', JSON.stringify(inflatedStats, null, 4), rawResults);
		const winrate: readonly TotalDataTurnInfo[] = battleResultHistory
			.filter(result => result?.simulationResult?.wonPercent)
			.map(result => ({
				turn: result.turn,
				totalDataPoints: 1,
				totalValue: result.simulationResult?.wonPercent,
			}));
		const result = {
			[miniReview.playerCardId]: {
				numberOfRuns: 1,
				winrate: winrate,
			},
		} as IntermediaryResult;
		// console.log('returning', result);
		return result;
	}

	public async mergeReduceEvents<IntermediaryResult>(
		inputResult: ReduceOutput<IntermediaryResult>,
		newResult: ReduceOutput<IntermediaryResult>,
	): Promise<ReduceOutput<IntermediaryResult>> {
		if (!inputResult || !inputResult.output) {
			console.log('currentResult is null', JSON.stringify(newResult, null, 4));
			return newResult;
		}
		if (!newResult || !newResult.output) {
			console.log('newResult is null', JSON.stringify(inputResult, null, 4));
			return inputResult;
		}

		const currentResult = {
			output: inputResult.output || {},
		} as ReduceOutput<any>;

		const output: IntermediaryResult = {} as IntermediaryResult;

		// console.log('will merge', JSON.stringify(currentResult, null, 4), JSON.stringify(newResult, null, 4));
		const existingCurrentResultKeys = Object.keys(currentResult.output);
		for (const playerCardId of existingCurrentResultKeys) {
			// console.log('merging', playerCardId, currentResult.output[playerCardId], newResult.output[playerCardId]);
			output[playerCardId] = {
				numberOfRuns:
					(currentResult.output[playerCardId]?.numberOfRuns || 0) +
					(newResult.output[playerCardId]?.numberOfRuns || 0),
				winrate: this.mergeOutputs(
					currentResult.output[playerCardId]?.winrate || [],
					newResult.output[playerCardId]?.winrate || [],
				),
			};
			// console.log('merged', output[playerCardId]);
		}

		// Might do the same thing twice, but it's clearer that way
		for (const playerCardId of Object.keys(newResult.output)) {
			if (existingCurrentResultKeys.includes(playerCardId)) {
				continue;
			}
			output[playerCardId] = {
				numberOfRuns:
					(currentResult.output[playerCardId]?.numberOfRuns || 0) +
					(newResult.output[playerCardId]?.numberOfRuns || 0),
				winrate: this.mergeOutputs(
					newResult.output[playerCardId]?.winrate || [],
					currentResult.output[playerCardId]?.winrate || [],
				),
			};
		}

		return {
			output: output,
		} as ReduceOutput<IntermediaryResult>;
	}

	private mergeOutputs(
		currentOutput: readonly TotalDataTurnInfo[],
		newOutput: readonly TotalDataTurnInfo[],
	): readonly TotalDataTurnInfo[] {
		const highestTurn: number = Math.max(
			currentOutput && currentOutput.length > 0 ? currentOutput[currentOutput.length - 1].turn : 0,
			newOutput && newOutput.length > 0 ? newOutput[newOutput.length - 1].turn : 0,
		);
		const result: TotalDataTurnInfo[] = [];
		for (let i = 0; i <= highestTurn; i++) {
			const currentTurn: TotalDataTurnInfo = (currentOutput && currentOutput.find(info => info.turn === i)) || {
				turn: i,
				totalDataPoints: 0,
				totalValue: 0,
			};
			const newTurn: TotalDataTurnInfo = (newOutput && newOutput.find(info => info.turn === i)) || {
				turn: i,
				totalDataPoints: 0,
				totalValue: 0,
			};
			result.push({
				turn: i,
				totalDataPoints: currentTurn.totalDataPoints + newTurn.totalDataPoints,
				totalValue: currentTurn.totalValue + newTurn.totalValue,
			});
		}
		return result;
	}

	private normalize(winratesForPlayer: IntermediaryResultForPlayer): NormalizedIntermediaryResultForPlayer {
		return {
			numberOfRuns: winratesForPlayer.numberOfRuns,
			winrate: winratesForPlayer.winrate.map(info => ({
				turn: info.turn,
				value: info.totalDataPoints > 0 ? info.totalValue / info.totalDataPoints : 0,
			})),
		};
	}

	public async transformOutput<IntermediaryResult>(
		output: ReduceOutput<IntermediaryResult>,
	): Promise<ReduceOutput<IntermediaryResult>> {
		console.log('transforming output', JSON.stringify(output, null, 4));
		const mergedOutput: ReduceOutput<IntermediaryResult> = await loadMergedOutput(
			this.JOB_NAME,
			output,
			(currentResult, newResult) => this.mergeReduceEvents(currentResult, newResult),
		);
		console.log('merged output', JSON.stringify(mergedOutput, null, 4));

		const normalizedValues: IntermediaryResult = {} as IntermediaryResult;
		for (const playerCardId of Object.keys(mergedOutput.output)) {
			// console.log('normalizing', playerCardId, mergedOutput.output[playerCardId]);
			normalizedValues[playerCardId] = this.normalize(mergedOutput.output[playerCardId]);
		}
		console.log('normalized ', JSON.stringify(normalizedValues, null, 4));

		// const finalOutput: ReduceOutput<IntermediaryResult> = {
		// 	output: normalizedValues,
		// } as ReduceOutput<IntermediaryResult>;

		const mysqlBgs = await getConnectionBgs();
		const creationDate = new Date().toISOString();
		const values = Object.keys(normalizedValues)
			.map(playerCardId => {
				const playerInfo: {
					numberOfRuns: number;
					winrate: readonly NumericTurnInfo[];
				} = normalizedValues[playerCardId];
				const playerWinrate: readonly NumericTurnInfo[] = playerInfo.winrate;
				return playerWinrate.map(winrate => ({
					cardId: playerCardId,
					turn: winrate.turn,
					winrate: winrate.value,
				}));
			})
			.reduce((a, b) => a.concat(b), [])
			.sort((a, b) => {
				if (a.cardId < b.cardId) {
					return -1;
				}
				if (a.cardId > b.cardId) {
					return 1;
				}
				if (a.turn < b.turn) {
					return -1;
				}
				return 1;
			})
			.map(
				winrateInfo =>
					`('${creationDate}', '${winrateInfo.cardId}', '${winrateInfo.turn}', '${winrateInfo.winrate}')`,
			)
			.join(',');
		const query = `
			INSERT INTO bgs_hero_combat_winrate
			(creationDate, heroCardId, turn, winrate)
			VALUES ${values}
		`;
		console.log('running query', query);
		await mysqlBgs.query(query);
		console.log('query run');

		return mergedOutput;
	}
}

const parseStats = (inputStats: string): BgsPostMatchStats => {
	try {
		const parsed = JSON.parse(inputStats);
		// console.log('parsed', parsed);
		return parsed;
	} catch (e) {
		try {
			// console.log('reading base64', inputStats);
			const fromBase64 = Buffer.from(inputStats, 'base64').toString();
			// console.log('fromBase64', fromBase64);
			const inflated = inflate(fromBase64, { to: 'string' });
			// console.log('inflated', inflated);
			return JSON.parse(inflated);
		} catch (e) {
			console.warn('Could not build full stats, ignoring review', inputStats);
		}
	}
};

interface IntermediaryResult {
	[playerCardId: string]: IntermediaryResultForPlayer;
}

interface IntermediaryResultForPlayer {
	numberOfRuns: number;
	winrate: readonly TotalDataTurnInfo[];
}

interface NormalizedIntermediaryResultForPlayer {
	numberOfRuns: number;
	winrate: readonly NumericTurnInfo[];
}

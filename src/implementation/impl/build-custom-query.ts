/* eslint-disable @typescript-eslint/no-use-before-define */
import { NumericTurnInfo } from '@firestone-hs/hs-replay-xml-parser/dist/lib/model/numeric-turn-info';
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { getConnection } from '../../mr-lambda-common/services/rds';
import { Implementation } from '../implementation';
import { TotalDataTurnInfo } from '../total-data-turn-info';
import { loadBgReviewIds, loadMergedOutput } from './battlegrounds-implementation-common';

export abstract class BuildCustomQuery implements Implementation<any> {
	private jobName = 'bg-damage-per-turn-over-time';

	protected abstract extractData(
		replay: Replay,
		miniReview: MiniReview,
		replayXml: string,
	): Promise<readonly TotalDataTurnInfo[]>;

	protected abstract getInsertionQuery(values: string): string;

	public async loadReviewIds(query: string): Promise<readonly string[]> {
		return loadBgReviewIds(query, this.jobName, 5000);
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview, replayXml: string): Promise<IntermediaryResult> {
		if (!replay) {
			console.warn('empty replay');
			return null;
		}

		const data: readonly TotalDataTurnInfo[] = await this.extractData(replay, miniReview, replayXml);
		const result = {
			[miniReview.playerCardId]: {
				data: data,
			},
		} as IntermediaryResult;
		return result;
	}

	public async mergeReduceEvents<IntermediaryResult>(
		inputResult: ReduceOutput<IntermediaryResult>,
		newResult: ReduceOutput<IntermediaryResult>,
	): Promise<ReduceOutput<IntermediaryResult>> {
		if (!inputResult || !inputResult.output) {
			return newResult;
		}
		if (!newResult || !newResult.output) {
			return inputResult;
		}

		const currentResult = {
			output: inputResult.output || {},
		} as ReduceOutput<IntermediaryResult>;

		const output: IntermediaryResult = {} as IntermediaryResult;

		const existingCurrentResultKeys = Object.keys(currentResult.output);
		for (const playerCardId of existingCurrentResultKeys) {
			output[playerCardId] = {
				data: this.mergeOutputs(
					currentResult.output[playerCardId]?.data || [],
					newResult.output[playerCardId]?.data || [],
				),
			};
		}

		// Might do the same thing twice, but it's clearer that way
		for (const playerCardId of Object.keys(newResult.output)) {
			if (existingCurrentResultKeys.includes(playerCardId)) {
				continue;
			}
			output[playerCardId] = {
				data: this.mergeOutputs(
					newResult.output[playerCardId]?.data || [],
					currentResult.output[playerCardId]?.data || [],
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

	public async transformOutput<IntermediaryResult>(
		output: ReduceOutput<IntermediaryResult>,
	): Promise<ReduceOutput<IntermediaryResult>> {
		const mergedOutput: ReduceOutput<IntermediaryResult> = await loadMergedOutput(
			this.jobName,
			output,
			(currentResult, newResult) => this.mergeReduceEvents(currentResult, newResult),
		);

		const normalizedValues: IntermediaryResult = {} as IntermediaryResult;
		for (const playerCardId of Object.keys(mergedOutput.output)) {
			normalizedValues[playerCardId] = this.normalize(mergedOutput.output[playerCardId]);
		}

		const mysqlBgs = await getConnection();
		const creationDate = new Date().toISOString();
		const values = Object.keys(normalizedValues)
			.map(playerCardId => {
				const playerInfo: NormalizedIntermediaryResultForPlayer = normalizedValues[playerCardId];
				const playerData: readonly NumericTurnInfo[] = playerInfo.data;
				return playerData.map(info => ({
					cardId: playerCardId,
					turn: info.turn,
					data: info.value,
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
			.map(info => `('${creationDate}', '${info.cardId}', '${info.turn}', '${info.data}')`)
			.join(',');
		const query = this.getInsertionQuery(values);
		await mysqlBgs.query(query);

		return mergedOutput;
	}

	protected getTotalDataPointsThreshold() {
		return 0;
	}

	private normalize(infoForPlayer: IntermediaryResultForPlayer): NormalizedIntermediaryResultForPlayer {
		return {
			data: infoForPlayer.data
				.filter(info => info.totalDataPoints > this.getTotalDataPointsThreshold())
				.map(info => ({
					turn: info.turn,
					value: info.totalDataPoints > 0 ? info.totalValue / info.totalDataPoints : 0,
				})),
		};
	}
}

interface IntermediaryResult {
	[playerCardId: string]: IntermediaryResultForPlayer;
}

interface IntermediaryResultForPlayer {
	data: readonly TotalDataTurnInfo[];
}

interface NormalizedIntermediaryResultForPlayer {
	data: readonly NumericTurnInfo[];
}

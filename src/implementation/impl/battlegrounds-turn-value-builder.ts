/* eslint-disable @typescript-eslint/no-use-before-define */
import { NumericTurnInfo } from '@firestone-hs/hs-replay-xml-parser/dist/lib/model/numeric-turn-info';
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { getConnection as getConnectionBgs } from '../../mr-lambda-common/services/rds-bgs';
import { Implementation } from '../implementation';
import { TotalDataTurnInfo } from '../total-data-turn-info';
import { loadBgReviewIds, loadMergedOutput } from './battlegrounds-implementation-common';

export abstract class BgsTurnValueBuilder implements Implementation<any> {
	private groupingKeyExtractor: (miniReview: MiniReview) => string;

	constructor(
		protected readonly jobName: string,
		protected readonly reviewLimit: number = 50000,
		groupingKey?: (miniReview: MiniReview) => string,
		protected readonly firstPatch?: number,
	) {
		this.groupingKeyExtractor = groupingKey ?? ((miniReview: MiniReview) => miniReview.playerCardId);
	}

	protected abstract extractData(
		replay: Replay,
		miniReview: MiniReview,
		replayXml: string,
	): Promise<readonly TotalDataTurnInfo[]>;

	protected abstract getInsertionQuery(
		creationDate: string,
		sortedValues: {
			key: string;
			turn: number;
			data: number;
		}[],
	): string;

	public async loadReviewIds(query: string): Promise<readonly string[]> {
		return loadBgReviewIds(query, this.jobName, this.reviewLimit, this.firstPatch);
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview, replayXml: string): Promise<IntermediaryResult> {
		if (!replay) {
			console.warn('empty replay');
			return null;
		}

		const data: readonly TotalDataTurnInfo[] = await this.extractData(replay, miniReview, replayXml);
		const key = this.groupingKeyExtractor(miniReview);
		const result = {
			[key]: {
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

		const output = await this.mergeIntermediaryResults(inputResult.output, newResult.output);

		return {
			output: output,
		} as ReduceOutput<IntermediaryResult>;
	}

	public async mergeIntermediaryResults<IntermediaryResult>(
		inputResult: IntermediaryResult,
		newResult: IntermediaryResult,
	): Promise<IntermediaryResult> {
		if (!inputResult) {
			return newResult;
		}
		if (!newResult) {
			return inputResult;
		}

		const output: IntermediaryResult = {} as IntermediaryResult;

		const existingCurrentResultKeys = Object.keys(inputResult);
		for (const key of existingCurrentResultKeys) {
			output[key] = {
				data: this.mergeOutputs(inputResult[key]?.data || [], newResult[key]?.data || []),
			};
		}

		// Might do the same thing twice, but it's clearer that way
		for (const key of Object.keys(newResult)) {
			if (existingCurrentResultKeys.includes(key)) {
				continue;
			}
			output[key] = {
				data: this.mergeOutputs(newResult[key]?.data || [], inputResult[key]?.data || []),
			};
		}

		return output;
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
		for (const key of Object.keys(mergedOutput.output)) {
			normalizedValues[key] = this.normalize(mergedOutput.output[key]);
		}

		const mysqlBgs = await getConnectionBgs();
		const creationDate = new Date().toISOString();
		const sortedValues = Object.keys(normalizedValues)
			.map(key => {
				const playerInfo: NormalizedIntermediaryResultForKey = normalizedValues[key];
				const playerData: readonly NumericTurnInfo[] = playerInfo.data;
				return playerData.map(info => ({
					key: key,
					turn: info.turn,
					data: info.value,
				}));
			})
			.reduce((a, b) => a.concat(b), [])
			.sort((a, b) => {
				if (a.key < b.key) {
					return -1;
				}
				if (a.key > b.key) {
					return 1;
				}
				if (a.turn < b.turn) {
					return -1;
				}
				return 1;
			});
		const query = this.getInsertionQuery(creationDate, sortedValues);
		if (query) {
			await mysqlBgs.query(query);
		}

		return mergedOutput;
	}

	protected getTotalDataPointsThreshold() {
		return 0;
	}

	private normalize(infoForKey: IntermediaryResultForKey): NormalizedIntermediaryResultForKey {
		return {
			data: infoForKey.data
				.filter(info => info.totalDataPoints > this.getTotalDataPointsThreshold())
				.map(info => ({
					turn: info.turn,
					value: info.totalDataPoints > 0 ? info.totalValue / info.totalDataPoints : 0,
				})),
		};
	}
}

interface IntermediaryResult {
	[playerCardId: string]: IntermediaryResultForKey;
}

interface IntermediaryResultForKey {
	data: readonly TotalDataTurnInfo[];
}

interface NormalizedIntermediaryResultForKey {
	data: readonly NumericTurnInfo[];
}

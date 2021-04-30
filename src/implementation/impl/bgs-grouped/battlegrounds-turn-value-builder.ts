/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { MiniReview } from '../../../mr-lambda-common/models/mini-review';
import { TotalDataTurnInfo } from '../../total-data-turn-info';
import { TurnInfoForDb } from './turn-info-for-db';

export abstract class BgsGroupedOperation {
	private groupingKeyExtractor: (miniReview: MiniReview) => string;
	private threshold = 0;

	constructor(groupingKey?: (miniReview: MiniReview) => string) {
		this.groupingKeyExtractor = groupingKey ?? ((miniReview: MiniReview) => miniReview.playerCardId);
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

	protected abstract async extractData(
		replay: Replay,
		miniReview: MiniReview,
		replayXml: string,
	): Promise<readonly TotalDataTurnInfo[]>;

	public async mergeIntermediaryResults(
		inputResult: IntermediaryResult,
		newResult: IntermediaryResult,
	): Promise<IntermediaryResult> {
		if (!inputResult) {
			return newResult;
		}
		if (!newResult) {
			return inputResult;
		}

		const result: IntermediaryResult = {} as IntermediaryResult;
		const existingCurrentResultKeys = Object.keys(inputResult);
		for (const key of existingCurrentResultKeys) {
			result[key] = {
				data: this.mergeOutputs(inputResult[key]?.data || [], newResult[key]?.data || []),
			};
		}

		// Might do the same thing twice, but it's clearer that way
		for (const key of Object.keys(newResult)) {
			if (existingCurrentResultKeys.includes(key)) {
				continue;
			}
			result[key] = {
				data: this.mergeOutputs(newResult[key]?.data || [], inputResult[key]?.data || []),
			};
		}

		return result;
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

	public async saveInDb(periodDate: string, resultToSave: IntermediaryResult, mysql) {
		const stats: readonly TurnInfoForDb[] = Object.keys(resultToSave)
			.map(playerCardId => {
				const dataForPlayer: IntermediaryResultForKey = resultToSave[playerCardId];
				return dataForPlayer.data.map(
					dataPoint =>
						({
							periodStart: periodDate,
							heroCardId: playerCardId,
							turn: dataPoint.turn,
							totalValue: dataPoint.totalValue,
							dataPoints: dataPoint.totalDataPoints,
						} as TurnInfoForDb),
				);
			})
			.reduce((a, b) => a.concat(b), [])
			.sort((a, b) => {
				if (a.heroCardId < b.heroCardId) {
					return -1;
				}
				if (a.heroCardId > b.heroCardId) {
					return 1;
				}
				if (a.turn < b.turn) {
					return -1;
				}
				return 1;
			});
		const tableName: string = this.getTableName();
		const values = stats
			.filter(stat => stat.totalValue > this.threshold)
			.map(
				stat =>
					`('${stat.periodStart}', '${stat.heroCardId}', ${stat.turn}, ${stat.dataPoints}, ${stat.totalValue})`,
			)
			.join(',');
		const query = `
			INSERT INTO ${tableName}
			(periodStart, heroCardId, turn, dataPoints, totalValue)
			VALUES ${values}
		`;
		await mysql.query(query);
	}

	protected abstract getTableName(): string;
}

interface IntermediaryResult {
	[playerCardId: string]: IntermediaryResultForKey;
}

interface IntermediaryResultForKey {
	data: readonly TotalDataTurnInfo[];
}

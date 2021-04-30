/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { Race } from '@firestone-hs/reference-data';
import { MiniReview } from '../../../mr-lambda-common/models/mini-review';
import { BgsTribesBuilder } from './../details/bgs-tribes-builder';
import { TotalDataTribeInfo } from './total-data-tribe-info';

export class BgsHeroesTribe {
	private threshold = 0;

	public getImplementationKey(): string {
		return 'bgs-heroes-tribe';
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview, replayXml: string): Promise<any> {
		if (!replay) {
			console.warn('empty replay');
			return null;
		}

		// By tribe, the total number of minions
		const data: { [tribeId: string]: number } = new BgsTribesBuilder().buidTribesAtEndGame(replay, replayXml);
		const dataForProcess: readonly TotalDataTribeInfo[] = Object.keys(data).map(
			tribeId =>
				({
					tribeId: +tribeId,
					totalDataPoints: 1,
					totalValue: data[tribeId],
				} as TotalDataTribeInfo),
		);
		return {
			[miniReview.playerCardId]: {
				data: dataForProcess,
			},
		};
	}

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
		currentOutput: readonly TotalDataTribeInfo[],
		newOutput: readonly TotalDataTribeInfo[],
	): readonly TotalDataTribeInfo[] {
		const result: TotalDataTribeInfo[] = [];
		const allTribeIds: readonly number[] = [
			...(currentOutput || []).map(data => data.tribeId),
			...(newOutput || []).map(data => data.tribeId),
		];
		const uniqueTribeIds: readonly number[] = [...new Set(allTribeIds)];
		for (const tribeId of uniqueTribeIds) {
			const currentData: TotalDataTribeInfo = currentOutput.find(other => other.tribeId === tribeId) || {
				tribeId: tribeId,
				totalDataPoints: 0,
				totalValue: 0,
			};
			const newData: TotalDataTribeInfo = newOutput.find(other => other.tribeId === tribeId) || {
				tribeId: tribeId,
				totalDataPoints: 0,
				totalValue: 0,
			};
			result.push({
				tribeId: tribeId,
				totalDataPoints: currentData.totalDataPoints + newData.totalDataPoints,
				totalValue: currentData.totalValue + newData.totalValue,
			});
		}
		return result;
	}

	public async saveInDb(periodDate: string, resultToSave: any, mysql) {
		const stats: readonly InfoForDb[] = Object.keys(resultToSave)
			.map(playerCardId => {
				const dataForPlayer: IntermediaryResultForKey = resultToSave[playerCardId];
				return dataForPlayer.data.map(dataPoint => {
					const tribe = Race[+dataPoint.tribeId];
					return {
						periodStart: periodDate,
						heroCardId: playerCardId,
						tribe: tribe?.toString(),
						totalValue: dataPoint.totalValue,
						dataPoints: dataPoint.totalDataPoints,
					} as InfoForDb;
				});
			})
			.reduce((a, b) => a.concat(b), [])
			.filter(stat => stat.tribe)
			.filter(stat => stat.totalValue > this.threshold)
			.sort((a, b) => {
				if (a.heroCardId < b.heroCardId) {
					return -1;
				}
				if (a.heroCardId > b.heroCardId) {
					return 1;
				}
				if (a.tribe < b.tribe) {
					return -1;
				}
				return 1;
			});
		const values = stats
			.map(
				stat =>
					`('${stat.periodStart}', '${stat.heroCardId}', '${stat.tribe}', ${stat.dataPoints}, ${stat.totalValue})`,
			)
			.join(',');
		const query = `
			INSERT INTO bgs_tribes_at_end
			(periodStart, heroCardId, tribe, dataPoints, totalValue)
			VALUES ${values}
		`;
		await mysql.query(query);
	}
}

interface IntermediaryResult {
	[playerCardId: string]: IntermediaryResultForKey;
}

interface IntermediaryResultForKey {
	data: readonly TotalDataTribeInfo[];
}

interface InfoForDb {
	readonly periodStart: string;
	readonly heroCardId: string;
	readonly tribe: string;
	readonly dataPoints: number;
	readonly totalValue: number;
}

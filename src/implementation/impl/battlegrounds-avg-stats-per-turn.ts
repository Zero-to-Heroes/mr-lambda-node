/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser';
import { Map } from 'immutable';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { getConnection } from '../../mr-lambda-common/services/rds';
import { Implementation } from '../implementation';
import { BgsCompsBuilder } from './details/bgs-comps-builder';

export class BgsAvgStatsPerTurn implements Implementation {
	public async loadReviewIds(query: string): Promise<readonly string[]> {
		const mysql = await getConnection();
		// SELECT reviewId FROM replay_summary WHERE gameMode = 'battlegrounds' AND additionalResult is not NULL
		const dbResults: any[] = await mysql.query(query);
		const result = dbResults.map(result => result.reviewId);
		return result;
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview, replayXml: string): Promise<any> {
		if (!replay) {
			console.warn('empty replay');
			return null;
		}
		const compsByTurn: Map<number, readonly any[]> = await new BgsCompsBuilder().buildCompsByTurn(
			replay,
			replayXml,
		);
		const statsByTurn = compsByTurn
			.map((value, key) => value.reduce((acc, obj) => acc + (obj.attack || 0) + (obj.health || 0), 0))
			.toJS();
		const numberOfTurns = compsByTurn.map((value, key) => 1).toJS();
		let previous = 0;
		for (const turn of Object.keys(statsByTurn)) {
			// if (statsByTurn[turn] < previous - 10) {
			// 	console.log(
			// 		'WARN: suspicious decrease in stats value',
			// 		miniReview.id,
			// 		turn,
			// 		statsByTurn[turn],
			// 		previous,
			// 	);
			// }
			previous = statsByTurn[turn];
		}
		console.log('statsByTurn', JSON.stringify(statsByTurn, null, 4));
		// console.log('numberOfTurns', numberOfTurns);
		return {
			stats: statsByTurn,
			numberOfTurns: numberOfTurns,
		};
	}

	public async mergeReduceEvents(currentResult: ReduceOutput, newResult: ReduceOutput): Promise<ReduceOutput> {
		if (!currentResult || !currentResult.output) {
			console.log('currentResult is null');
			return newResult;
		}
		if (!newResult || !newResult.output) {
			console.log('newResult is null');
			return currentResult;
		}
		// console.log('merging', JSON.stringify(currentResult, null, 4), JSON.stringify(newResult, null, 4));

		const output = this.mergeOutputs(currentResult.output, newResult.output || { stats: {}, numberOfTurns: {} });
		// console.log('merged output', JSON.stringify(output, null, 4));

		return {
			output: output,
		} as ReduceOutput;
	}

	private mergeOutputs(currentOutput, newOutput) {
		// console.log('merging outputs', JSON.stringify(currentOutput, null, 4), JSON.stringify(newOutput, null, 4));
		const result: any = {
			numberOfTurns: {},
			stats: {},
		};
		for (const turn of Object.keys(currentOutput.stats)) {
			const newStats = newOutput.stats[turn] != null ? newOutput.stats[turn] : 0;
			const newTurns = newOutput.numberOfTurns[turn] != null ? newOutput.numberOfTurns[turn] : 0;
			result.stats[turn] = currentOutput.stats[turn] + newStats;
			result.numberOfTurns[turn] = currentOutput.numberOfTurns[turn] + newTurns;
		}
		for (const turn of Object.keys(newOutput.stats)) {
			if (Object.keys(currentOutput.stats).indexOf(turn) === -1) {
				result.stats[turn] = newOutput.stats[turn];
				result.numberOfTurns[turn] = newOutput.numberOfTurns[turn];
			}
		}
		// console.log('merged outputs', JSON.stringify(result, null, 4));
		return result;
	}

	public async transformOutput(output: ReduceOutput): Promise<ReduceOutput> {
		console.log('transforming final output', JSON.stringify(output, null, 4));
		// let maxTurns = 0;
		// for (const finalPosition of Object.keys(output.output)) {
		// 	const maxTurnsForFinalPosition = Math.max(
		// 		...Object.keys(output.output.stats).map(key => parseInt(key)),
		// 	);
		// 	maxTurns = Math.max(maxTurns, maxTurnsForFinalPosition);
		// }
		const result: string[] = [];
		// let max = 0;
		// for (const finalPosition of Object.keys(output.output)) {
		// 	for (const turn of Object.keys(output.output[finalPosition].stats)) {
		// 		max = Math.max(max, output.output[finalPosition].numberOfTurns[turn]);
		// 	}
		// }
		// const threshold = max / 100;
		const positionResult = [];
		for (const turn of Object.keys(output.output.stats)) {
			// if (output.output[finalPosition].numberOfTurns[turn] < threshold) {
			// 	continue;
			// }
			const totalStats: number = output.output.stats[turn];
			positionResult.push('' + totalStats / output.output.numberOfTurns[turn]);
		}
		result.push(positionResult.join(','));
		return {
			output: result.join('\n'),
		} as ReduceOutput;
	}
}
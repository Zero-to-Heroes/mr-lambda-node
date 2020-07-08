/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { Map } from 'immutable';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { getConnection } from '../../mr-lambda-common/services/rds';
import { Implementation } from '../implementation';
import { BgsCompsBuilder } from './details/bgs-comps-builder';

export class BgsAvgStatsPerTurnPerFinalPosition implements Implementation {
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
		return {
			[miniReview.additionalResult]: {
				numberOfTurns: numberOfTurns,
				stats: statsByTurn,
			},
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

		const output = {};

		for (const finalPosition of Object.keys(currentResult.output)) {
			output[finalPosition] = this.mergeOutputs(
				currentResult.output[finalPosition],
				newResult.output[finalPosition] || { stats: {}, numberOfTurns: {} },
			);
		}
		// Might do the same thing twice, but it's clearer that way
		for (const finalPosition of Object.keys(newResult.output)) {
			output[finalPosition] = this.mergeOutputs(
				newResult.output[finalPosition],
				currentResult.output[finalPosition] || { stats: {}, numberOfTurns: {} },
			);
		}

		return {
			output: output,
		} as ReduceOutput;
	}

	private mergeOutputs(currentOutput, newOutput) {
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
		return result;
	}

	public async transformOutput(output: ReduceOutput): Promise<ReduceOutput> {
		delete output.output['0'];
		delete output.output['null'];
		let maxTurns = 0;
		for (const finalPosition of Object.keys(output.output)) {
			const maxTurnsForFinalPosition = Math.max(
				...Object.keys(output.output[finalPosition].stats).map(key => parseInt(key)),
			);
			maxTurns = Math.max(maxTurns, maxTurnsForFinalPosition);
		}
		const result: string[] = [];
		let max = 0;
		for (const finalPosition of Object.keys(output.output)) {
			for (const turn of Object.keys(output.output[finalPosition].stats)) {
				max = Math.max(max, output.output[finalPosition].numberOfTurns[turn]);
			}
		}
		const threshold = max / 100;
		for (const finalPosition of Object.keys(output.output)) {
			const positionResult = [finalPosition];
			for (const turn of Object.keys(output.output[finalPosition].stats)) {
				if (output.output[finalPosition].numberOfTurns[turn] < threshold) {
					continue;
				}
				const totalStats: number = output.output[finalPosition].stats[turn];
				positionResult.push('' + totalStats / output.output[finalPosition].numberOfTurns[turn]);
			}
			result.push(positionResult.join(','));
		}
		return {
			output: result.join('\n'),
		} as ReduceOutput;
	}
}

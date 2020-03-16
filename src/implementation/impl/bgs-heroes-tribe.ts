/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser';
import { Race } from '@firestone-hs/reference-data';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { getConnection } from '../../mr-lambda-common/services/rds';
import { getConnection as getConnectionBgs } from '../../mr-lambda-common/services/rds-bgs';
import { Implementation } from '../implementation';
import { BgsTribesBuilder } from './details/bgs-tribes-builder';

export class BgsHeroesTribe implements Implementation {
	public async loadReviewIds(query: string): Promise<readonly string[]> {
		// Don't forget: keep only the top 4 in the query
		const mysql = await getConnection();
		const dbResults: any[] = await mysql.query(query);
		const result = dbResults.map(result => result.reviewId);
		return result;
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview, replayXml: string): Promise<any> {
		if (!replay) {
			console.warn('empty replay');
			return null;
		}

		// By tribe, the total number of minions
		const tribesAtEndOfGame = await new BgsTribesBuilder().buidTribesAtEndGame(replay, replayXml);
		// console.log('tribesAtEndOfGame', JSON.stringify(tribesAtEndOfGame, null, 4));
		return {
			[miniReview.playerCardId]: {
				tribesAtEndOfGame: tribesAtEndOfGame,
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
		// console.log('merging', JSON.stringify(currentResult, null, 4), JSON.stringify(newResult, null, 4));

		const output = {};

		for (const playerCardId of Object.keys(currentResult.output)) {
			// console.log(
			// 	'considering from currentResult',
			// 	playerCardId,
			// 	currentResult,
			// 	currentResult.output[playerCardId],
			// 	newResult,
			// 	newResult.output[playerCardId],
			// );
			output[playerCardId] = this.mergeOutputs(
				currentResult.output[playerCardId],
				newResult.output[playerCardId] || { tribesAtEndOfGame: {} },
			);
		}
		// Might do the same thing twice, but it's clearer that way
		for (const playerCardId of Object.keys(newResult.output)) {
			// console.log(
			// 	'considering from newResult',
			// 	playerCardId,
			// 	currentResult,
			// 	currentResult.output[playerCardId],
			// 	newResult,
			// 	newResult.output[playerCardId],
			// );
			output[playerCardId] = this.mergeOutputs(
				newResult.output[playerCardId],
				currentResult.output[playerCardId] || { tribesAtEndOfGame: {} },
			);
		}
		// console.log('merged output', JSON.stringify(output, null, 4));

		return {
			output: output,
		} as ReduceOutput;
	}

	private mergeOutputs(currentOutput, newOutput) {
		// console.log('merging outputs', JSON.stringify(currentOutput, null, 4), JSON.stringify(newOutput, null, 4));
		const result: any = {
			tribesAtEndOfGame: {},
		};

		for (const tribe of Object.keys(currentOutput.tribesAtEndOfGame)) {
			const newTribeTotal = currentOutput.tribesAtEndOfGame[tribe] + (newOutput.tribesAtEndOfGame[tribe] || 0);
			result.tribesAtEndOfGame[tribe] = newTribeTotal;
		}
		for (const tribe of Object.keys(newOutput.tribesAtEndOfGame)) {
			if (Object.keys(currentOutput.tribesAtEndOfGame).indexOf(tribe) === -1) {
				const newTribeTotal = newOutput.tribesAtEndOfGame[tribe];
				result.tribesAtEndOfGame[tribe] = newTribeTotal;
			}
		}
		// console.log('merged outputs', JSON.stringify(result, null, 4));
		return result;
	}

	public async transformOutput(output: ReduceOutput): Promise<ReduceOutput> {
		console.log('transforming final output', JSON.stringify(output, null, 4));
		const mysql = await getConnectionBgs();
		const creationDate = new Date().toISOString();
		const tribes = [];
		for (const playerCardId of Object.keys(output.output)) {
			const tribesAtEnd = output.output[playerCardId].tribesAtEndOfGame;
			const totalTribes: number = Object.values(tribesAtEnd).reduce((a: number, b: number) => a + b, 0) as number;
			const tribesWithPercents = Object.keys(tribesAtEnd).map(tribe => ({
				playerCardId: playerCardId,
				tribe: Race[parseInt(tribe) === -1 ? Race.BLANK : tribe],
				percentPresence: (100 * parseInt(tribesAtEnd[tribe])) / totalTribes,
			}));
			tribes.push(...tribesWithPercents);
			console.log('tribes with percents for', playerCardId, 'is', tribesWithPercents);
		}
		console.log('built data', tribes);
		const values = tribes
			.map(
				tribeInfo =>
					`('${tribeInfo.playerCardId}', '${creationDate}', '${tribeInfo.tribe}', '${tribeInfo.percentPresence}')`,
			)
			.join(',');
		const query = `
			INSERT INTO bgs_hero_tribes_at_end
			(heroCardId, date, tribe, percent)
			VALUES ${values}
		`;
		console.log('running query', query);
		await mysql.query(query);
		console.log('query run');

		// TODO: save in DB
		return output;
	}
}

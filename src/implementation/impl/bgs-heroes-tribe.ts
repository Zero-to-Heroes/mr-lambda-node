/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { Race } from '@firestone-hs/reference-data';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { getConnection as getConnectionBgs } from '../../mr-lambda-common/services/rds-bgs';
import { Implementation } from '../implementation';
import { loadBgReviewIds, loadMergedOutput } from './battlegrounds-implementation-common';
import { BgsTribesBuilder } from './details/bgs-tribes-builder';

export class BgsHeroesTribe implements Implementation {
	private readonly JOB_NAME = 'bgs-heroes-tribe';

	public async loadReviewIds(query: string): Promise<readonly string[]> {
		return loadBgReviewIds(query, this.JOB_NAME);
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview, replayXml: string): Promise<any> {
		if (!replay) {
			console.warn('empty replay');
			return null;
		}

		// By tribe, the total number of minions
		const tribesAtEndOfGame = new BgsTribesBuilder().buidTribesAtEndGame(replay, replayXml);
		delete tribesAtEndOfGame[Race.ALL];
		console.log('tribes at the end', tribesAtEndOfGame);
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

		const output = {};

		for (const playerCardId of Object.keys(currentResult.output)) {
			output[playerCardId] = this.mergeOutputs(
				currentResult.output[playerCardId],
				newResult.output[playerCardId] || { tribesAtEndOfGame: {} },
			);
		}
		// Might do the same thing twice, but it's clearer that way
		for (const playerCardId of Object.keys(newResult.output)) {
			output[playerCardId] = this.mergeOutputs(
				newResult.output[playerCardId],
				currentResult.output[playerCardId] || { tribesAtEndOfGame: {} },
			);
		}

		return {
			output: output,
		} as ReduceOutput;
	}

	private mergeOutputs(currentOutput, newOutput) {
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
		return result;
	}

	public async transformOutput(output: ReduceOutput): Promise<ReduceOutput> {
		const mergedOutput = await loadMergedOutput(this.JOB_NAME, output, this.mergeReduceEvents);
		// console.log('final output before merge with previous job data', JSON.stringify(output, null, 4));
		// const lastBattlegroundsPatch = await getLastBattlegroundsPatch();
		// const mysql = await getConnection();
		// const lastJobQuery = `
		// 	SELECT * FROM mr_job_summary
		// 	WHERE jobName = '${this.JOB_NAME}'
		// 	AND relevantPatch = '${lastBattlegroundsPatch}'
		// 	ORDER BY lastDateRan DESC
		// 	LIMIT 1
		// `;
		// const lastJobData: readonly any[] = await mysql.query(lastJobQuery);
		// console.log('lastJobData', lastJobData);

		// const lastOutput = lastJobData && lastJobData.length > 0 ? JSON.parse(lastJobData[0].dataAtJobEnd) : {};
		// console.log('lastOutput', JSON.stringify(lastOutput, null, 4));

		// const mergedOutput = await this.mergeReduceEvents(output, lastOutput);
		// console.log('transforming merged output', JSON.stringify(mergedOutput, null, 4));

		// const lastDateRan = new Date();
		// lastDateRan.setHours(0, 0, 0, 0);
		// const saveQuery = `
		// 	INSERT INTO mr_job_summary (jobName, lastDateRan, relevantPatch, dataAtJobEnd)
		// 	VALUES ('${this.JOB_NAME}', '${formatDate(lastDateRan)}', ${lastBattlegroundsPatch}, '${JSON.stringify(mergedOutput)}')
		// `;
		// await mysql.query(saveQuery);

		const mysqlBgs = await getConnectionBgs();
		const creationDate = new Date().toISOString();
		const tribes = [];
		for (const playerCardId of Object.keys(mergedOutput.output)) {
			const tribesAtEnd = mergedOutput.output[playerCardId].tribesAtEndOfGame;
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
			(heroCardId, creationDate, tribe, percent)
			VALUES ${values}
		`;
		console.log('running query', query);
		await mysqlBgs.query(query);
		console.log('query run');

		return mergedOutput;
	}
}

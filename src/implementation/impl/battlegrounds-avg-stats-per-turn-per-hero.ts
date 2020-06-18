/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { Map } from 'immutable';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { getConnection } from '../../mr-lambda-common/services/rds';
import { getConnection as getConnectionBgs } from '../../mr-lambda-common/services/rds-bgs';
import { Implementation } from '../implementation';
import { BgsCompsBuilder } from './details/bgs-comps-builder';
import { HeroStatsProfile } from './details/hero-stats-profile';

export class BgsAvgStatsPerTurnPerHero implements Implementation {
	public async loadReviewIds(query: string): Promise<readonly string[]> {
		const mysql = await getConnection();
		// SELECT reviewId FROM replay_summary WHERE gameMode = 'battlegrounds' AND buildNumber = 42174 AND playerCardId like 'TB_BaconShop_HERO_%'
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
		// console.log('statsByTurn', JSON.stringify(statsByTurn, null, 4));
		// console.log('numberOfTurns', numberOfTurns);
		return {
			[miniReview.playerCardId]: {
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
		// console.log('merging', JSON.stringify(currentResult, null, 4), JSON.stringify(newResult, null, 4));

		const output = {};

		for (const playerCardId of Object.keys(currentResult.output)) {
			output[playerCardId] = this.mergeOutputs(
				currentResult.output[playerCardId],
				newResult.output[playerCardId] || { stats: {}, numberOfTurns: {} },
			);
		}
		// Might do the same thing twice, but it's clearer that way
		for (const playerCardId of Object.keys(newResult.output)) {
			output[playerCardId] = this.mergeOutputs(
				newResult.output[playerCardId],
				currentResult.output[playerCardId] || { stats: {}, numberOfTurns: {} },
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

		const threshold = this.buildThreshold(output);
		console.log('threshold is', threshold);

		// build the formatted data, which i the diff from average
		const heroStatsProfile: readonly HeroStatsProfile[] = this.buildHeroStatsProfiles(output, threshold);
		console.log('heroStatsProfile', heroStatsProfile);

		// Save the data in db
		const creationDate = new Date().toISOString();
		const values: string = heroStatsProfile
			.map(result =>
				result.deltaStatsPerTurn
					.map((value: number, key: number) => ({
						heroCardId: result.heroCardId,
						turn: key,
						statsDelta: value,
					}))
					.valueSeq()
					.toArray(),
			)
			.reduce((a, b) => a.concat(b), [])
			.map(line => `( '${line.heroCardId}', '${creationDate}', ${line.turn}, ${line.statsDelta} )`)
			.join(',');
		const mysqlBgs = await getConnectionBgs();
		const query = `
			INSERT INTO bgs_hero_warband_stats
			(heroCardId, creationDate, turn, statsDelta)
			VALUES ${values}
		`;
		console.log('running update query', query);
		const updateResult = await mysqlBgs.query(query);
		console.log('data inserted', updateResult);
		return {
			output: heroStatsProfile,
		} as ReduceOutput;

		// const result: string[] = [];
		// for (const playerCardId of Object.keys(output.output)) {
		// 	const positionResult = [playerCardId];
		// 	for (const turn of Object.keys(output.output[playerCardId].stats)) {
		// 		if (output.output[playerCardId].numberOfTurns[turn] < threshold) {
		// 			continue;
		// 		}
		// 		const totalStats: number = output.output[playerCardId].stats[turn];
		// 		positionResult.push('' + totalStats / output.output[playerCardId].numberOfTurns[turn]);
		// 	}
		// 	heroStatsProfile.push(positionResult.join(','));
		// }
		// return {
		// 	output: heroStatsProfile.join('\n'),
		// } as ReduceOutput;
	}

	private buildHeroStatsProfiles(output: ReduceOutput, threshold: number): readonly HeroStatsProfile[] {
		const rawProfiles: HeroStatsProfile[] = [];
		for (const playerCardId of Object.keys(output.output)) {
			const rawProfile = {
				heroCardId: playerCardId,
				deltaStatsPerTurn: Map.of(),
			} as HeroStatsProfile;
			for (const turn of Object.keys(output.output[playerCardId].stats)) {
				// if (output.output[playerCardId].numberOfTurns[turn] < threshold) {
				// 	continue;
				// }
				const totalStats: number = output.output[playerCardId].stats[turn];
				rawProfile.deltaStatsPerTurn = rawProfile.deltaStatsPerTurn.set(
					parseInt(turn),
					totalStats / output.output[playerCardId].numberOfTurns[turn],
				);
			}
			rawProfiles.push(rawProfile);
		}
		console.log('rawProfiles', rawProfiles);

		let average: Map<number, number> = Map.of();
		let isThereData = true;
		let currentTurn = 0;
		while (isThereData) {
			const totalDataForTurn = rawProfiles
				.map(profile => profile.deltaStatsPerTurn.get(currentTurn, 0))
				.reduce((a, b) => a + b, 0);
			isThereData = totalDataForTurn > 0;
			const averageDataForTurn = totalDataForTurn / rawProfiles.length;
			average = average.set(currentTurn, averageDataForTurn);
			currentTurn++;
		}
		console.log('average', average);
		// rawProfiles.push({
		// 	heroCardId: 'average',
		// 	deltaStatsPerTurn: average,
		// });

		const deltaProfiles = [
			...rawProfiles.map(
				profile =>
					({
						heroCardId: profile.heroCardId,
						deltaStatsPerTurn: profile.deltaStatsPerTurn.map((value, turn) => value - average.get(turn, 0)),
					} as HeroStatsProfile),
			),
			{
				heroCardId: 'average',
				deltaStatsPerTurn: average,
			},
		];
		console.log('deltaProfiles', deltaProfiles);
		return deltaProfiles;
	}

	private buildThreshold(output: ReduceOutput): number {
		return 20;
		let maxTurns = 0;
		for (const playerCardId of Object.keys(output.output)) {
			const maxTurnsForPlayerCardId = Math.max(
				...Object.keys(output.output[playerCardId].stats).map(key => parseInt(key)),
			);
			maxTurns = Math.max(maxTurns, maxTurnsForPlayerCardId);
		}
		let max = 0;
		for (const playerCardId of Object.keys(output.output)) {
			for (const turn of Object.keys(output.output[playerCardId].stats)) {
				max = Math.max(max, output.output[playerCardId].numberOfTurns[turn]);
			}
		}
		const threshold = max / 300;
		return threshold;
	}
}

/* eslint-disable @typescript-eslint/no-use-before-define */
import {
	extractTotalMinionDeaths,
	PlayerOpponentValues,
	Replay,
} from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { MiniReview } from '../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/models/reduce-output';
import { getConnection } from '../../mr-lambda-common/services/rds';
import { Implementation } from '../implementation';

export class GalakrondMinionsKilled implements Implementation<any> {
	public async loadReviewIds(query: string): Promise<readonly string[]> {
		const mysql = await getConnection();
		// Galakrond's Awakening Normal - Explorers
		const dbResults: any[] = await mysql.query(query);
		// Galakrond's Awakening Normal - EVIL
		// const dbResults: any[] = await mysql.query(
		// 	`
		// 	SELECT reviewId FROM replay_summary WHERE scenarioId in (3490, 3491, 3493)
		// `,
		// );
		// Galakrond's Awakening Heroic
		// const dbResults: any[] = await mysql.query(
		// 	`
		// 	SELECT reviewId
		// 	FROM replay_summary
		// 	WHERE scenarioId in (3556, 3583, 3584, 3585, 3586, 3587, 3594, 3595, 3596, 3597, 3598, 3599)
		// `,
		// );
		const result = dbResults.map(result => result.reviewId);
		return result;
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview): Promise<any> {
		if (!replay) {
			console.warn('empty replay');
			return null;
		}
		return extractTotalMinionDeaths(replay);
	}

	public async mergeReduceEvents(
		currentResult: ReduceOutput<any>,
		newResult: ReduceOutput<any>,
	): Promise<ReduceOutput<any>> {
		if (!currentResult || !currentResult.output) {
			return newResult;
		}
		if (!newResult || !newResult.output) {
			return currentResult;
		}
		return {
			output: {
				player: (currentResult.output.player || 0) + (newResult.output.player || 0),
				opponent: (currentResult.output.opponent || 0) + (newResult.output.opponent || 0),
			} as PlayerOpponentValues,
		} as ReduceOutput<any>;
	}

	public async transformOutput(output: ReduceOutput<any>): Promise<ReduceOutput<any>> {
		return output;
	}
}

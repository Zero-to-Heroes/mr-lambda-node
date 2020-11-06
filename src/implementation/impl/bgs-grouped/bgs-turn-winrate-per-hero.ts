/* eslint-disable @typescript-eslint/no-use-before-define */
import { BgsPostMatchStats, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { inflate } from 'pako';
import { MiniReview } from '../../../mr-lambda-common/models/mini-review';
import { getConnection as getConnectionBgs } from '../../../mr-lambda-common/services/rds-bgs';
import { TotalDataTurnInfo } from '../../total-data-turn-info';
import { BgsGroupedOperation } from './battlegrounds-turn-value-builder';

export class BgsCombatWinrate extends BgsGroupedOperation {
	public getImplementationKey(): string {
		return 'bgs-combat-winrate';
	}

	protected async extractData(
		replay: Replay,
		miniReview: MiniReview,
		replayXml: string,
	): Promise<readonly TotalDataTurnInfo[]> {
		const mysql = await getConnectionBgs();
		const loadQuery = `
			SELECT * FROM bgs_single_run_stats
			WHERE reviewId = '${miniReview.id}'
		`;
		console.log('running query', loadQuery);
		const rawResults = await mysql.query(loadQuery);
		const postMatchStats: any[] = (rawResults as any[]).filter(
			result => result.jsonStats && result.jsonStats.length <= 50000,
		);
		if (!postMatchStats || postMatchStats.length === 0) {
			console.log('no postmatchstats, returning', loadQuery, rawResults);
			return null;
		}
		if (postMatchStats.length > 1) {
			console.error('Too many postmatch stats for review', miniReview.id);
			return null;
		}

		const inflatedStats = postMatchStats
			.map(result => {
				const stats = parseStats(result.jsonStats);
				return {
					reviewId: result.reviewId,
					stats: stats,
				};
			})
			.filter(result => result.stats);
		if (!inflatedStats || inflatedStats.length === 0) {
			console.log('no inflatedStats, returning', loadQuery, rawResults);
			return null;
		}

		const battleResultHistory = inflatedStats[0].stats.battleResultHistory;
		if (!battleResultHistory || battleResultHistory.length === 0) {
			console.log('no battleResultHistory, returning', loadQuery);
			return null;
		}

		// console.log('inflated stats', JSON.stringify(inflatedStats, null, 4), rawResults);
		const winrate: readonly TotalDataTurnInfo[] = battleResultHistory
			.filter(result => result?.simulationResult?.wonPercent != null)
			.map(result => ({
				turn: result.turn,
				totalDataPoints: 1,
				totalValue: result.simulationResult?.wonPercent,
			}));
		return winrate;
	}

	protected getTableName() {
		return 'bgs_winrate';
	}
}

const parseStats = (inputStats: string): BgsPostMatchStats => {
	try {
		const parsed = JSON.parse(inputStats);
		// console.log('parsed', parsed);
		return parsed;
	} catch (e) {
		try {
			// console.log('reading base64', inputStats);
			const fromBase64 = Buffer.from(inputStats, 'base64').toString();
			// console.log('fromBase64', fromBase64);
			const inflated = inflate(fromBase64, { to: 'string' });
			// console.log('inflated', inflated);
			return JSON.parse(inflated);
		} catch (e) {
			console.warn('Could not build full stats, ignoring review', inputStats);
		}
	}
};

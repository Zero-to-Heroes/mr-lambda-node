/* eslint-disable @typescript-eslint/no-use-before-define */
import { BgsPostMatchStats, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { inflate } from 'pako';
import { MiniReview } from '../../../mr-lambda-common/models/mini-review';
import { getConnection } from '../../../mr-lambda-common/services/rds';
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
		const mysql = await getConnection();
		const loadQuery = `
			SELECT * FROM bgs_single_run_stats
			WHERE reviewId = '${miniReview.id}'
		`;
		const rawResults = await mysql.query(loadQuery);
		await mysql.end();
		const postMatchStats: any[] = (rawResults as any[]).filter(
			result => result.jsonStats && result.jsonStats.length <= 50000,
		);
		if (!postMatchStats || postMatchStats.length === 0) {
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
			return null;
		}

		const battleResultHistory = inflatedStats[0].stats.battleResultHistory;
		if (!battleResultHistory || battleResultHistory.length === 0) {
			return null;
		}

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
		return parsed;
	} catch (e) {
		try {
			const fromBase64 = Buffer.from(inputStats, 'base64').toString();
			const inflated = inflate(fromBase64, { to: 'string' });
			return JSON.parse(inflated);
		} catch (e) {
			console.warn('Could not build full stats, ignoring review', inputStats);
		}
	}
};

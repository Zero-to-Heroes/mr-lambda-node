/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
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
			SELECT combatWinrate FROM bgs_run_stats
			WHERE reviewId = '${miniReview.id}'
		`;
		const rawResults: readonly { combatWinrate: string }[] = await mysql.query(loadQuery);
		await mysql.end();

		if (!rawResults[0]?.combatWinrate?.length) {
			return null;
		}

		const rawWinrate: readonly { turn: number; winrate: number }[] = JSON.parse(rawResults[0].combatWinrate);
		const winrate: readonly TotalDataTurnInfo[] = rawWinrate.map(w => ({
			turn: w.turn,
			totalDataPoints: 1,
			totalValue: w.winrate,
		}));
		return winrate;
	}

	protected getTableName() {
		return 'bgs_winrate';
	}
}
